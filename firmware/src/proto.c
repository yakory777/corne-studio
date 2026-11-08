/*
 * Corne Tool — текстовый протокол поверх USB CDC ACM (виртуальный COM-порт).
 *
 * Каждая команда — одна строка ASCII, заканчивается '\n'.
 * Ответ: "OK <команда>" или "ERR <причина>". Плюс асинхронные события
 * (KEY ..., LAYER ...). Полное описание — PROTOCOL.md в корне репозитория.
 *
 * SPDX-License-Identifier: MIT
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/drivers/led_strip.h>
#include <zephyr/sys/ring_buffer.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/logging/log.h>

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zmk/event_manager.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/behavior.h>
#include <zmk/usb.h>
#include <dt-bindings/zmk/rgb.h>
#include <dt-bindings/zmk/reset.h>

#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
#include <zmk/rgb_underglow.h>
#endif

#if DT_HAS_COMPAT_STATUS_OKAY(zmk_ext_power_generic)
#include <drivers/ext_power.h>
#endif

#define CT_IS_CENTRAL (!IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL))

#if CT_IS_CENTRAL
#include <zmk/keymap.h>
#include <zmk/events/layer_state_changed.h>
#if IS_ENABLED(CONFIG_ZMK_BLE)
#include <zmk/ble.h>
#endif
#endif

#include "corne_tool.h"

LOG_MODULE_REGISTER(corne_tool, CONFIG_ZMK_LOG_LEVEL);

#define CT_VERSION "0.3.0"

#if !DT_NODE_EXISTS(DT_NODELABEL(corne_tool_uart))
#error "corne_tool_uart node missing: build with snippet 'corne-tool'"
#endif

static const struct device *const uart = DEVICE_DT_GET(DT_NODELABEL(corne_tool_uart));

RING_BUF_DECLARE(rx_rb, 2048);
RING_BUF_DECLARE(tx_rb, 4096);
static struct k_spinlock tx_lock;
static struct k_spinlock rx_lock;
static bool keys_stream;

/* ------------------------------------------------------------------ */
/* Светодиоды                                                          */
/* ------------------------------------------------------------------ */

#if DT_HAS_CHOSEN(zmk_underglow)
#define CT_STRIP DT_CHOSEN(zmk_underglow)
#define CT_NLEDS DT_PROP(CT_STRIP, chain_length)
static const struct device *const strip = DEVICE_DT_GET(CT_STRIP);
static struct led_rgb px[CT_NLEDS];
static struct led_rgb px_tmp[CT_NLEDS];
#else
#define CT_NLEDS 0
#endif

static bool host_led_mode;
static bool fw_was_on;

/* ------------------------------------------------------------------ */
/* Отправка                                                            */
/* ------------------------------------------------------------------ */

static bool host_connected(void) {
    uint32_t dtr = 0;
    if (uart_line_ctrl_get(uart, UART_LINE_CTRL_DTR, &dtr) != 0) {
        return true; /* не можем узнать — считаем, что подключён */
    }
    return dtr != 0;
}

static void ct_send(const char *s, size_t len) {
    if (!device_is_ready(uart) || !host_connected()) {
        return;
    }
    k_spinlock_key_t key = k_spin_lock(&tx_lock);
    if (ring_buf_space_get(&tx_rb) >= len) {
        ring_buf_put(&tx_rb, (const uint8_t *)s, len);
    }
    k_spin_unlock(&tx_lock, key);
    uart_irq_tx_enable(uart);
}

static void ct_printf(const char *fmt, ...) {
    char buf[200];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
    va_end(ap);
    if (n < 0) {
        return;
    }
    if (n > (int)sizeof(buf) - 2) {
        n = sizeof(buf) - 2;
    }
    buf[n++] = '\n';
    ct_send(buf, n);
}

/* ------------------------------------------------------------------ */
/* Прерывание UART                                                     */
/* ------------------------------------------------------------------ */

static void rx_work_cb(struct k_work *work);
K_WORK_DEFINE(rx_work, rx_work_cb);

static void uart_isr(const struct device *dev, void *user_data) {
    ARG_UNUSED(user_data);
    while (uart_irq_update(dev) && uart_irq_is_pending(dev)) {
        if (uart_irq_rx_ready(dev)) {
            uint8_t buf[64];
            int n = uart_fifo_read(dev, buf, sizeof(buf));
            if (n > 0) {
                k_spinlock_key_t rk = k_spin_lock(&rx_lock);
                ring_buf_put(&rx_rb, buf, n);
                k_spin_unlock(&rx_lock, rk);
                k_work_submit(&rx_work);
            }
        }
        if (uart_irq_tx_ready(dev)) {
            uint8_t *data;
            k_spinlock_key_t key = k_spin_lock(&tx_lock);
            uint32_t len = ring_buf_get_claim(&tx_rb, &data, 64);
            if (len == 0) {
                ring_buf_get_finish(&tx_rb, 0);
                uart_irq_tx_disable(dev);
            } else {
                int sent = uart_fifo_fill(dev, data, len);
                ring_buf_get_finish(&tx_rb, sent > 0 ? sent : 0);
            }
            k_spin_unlock(&tx_lock, key);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Помощники разбора                                                   */
/* ------------------------------------------------------------------ */

static char *next_tok(char **s) {
    char *p = *s;
    while (*p == ' ') {
        p++;
    }
    if (*p == '\0') {
        *s = p;
        return NULL;
    }
    char *start = p;
    while (*p && *p != ' ') {
        p++;
    }
    if (*p) {
        *p++ = '\0';
    }
    *s = p;
    return start;
}

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static bool parse_rgb(const char *h, uint8_t *r, uint8_t *g, uint8_t *b) {
    uint8_t v[3];
    for (int i = 0; i < 3; i++) {
        int hi = hexval(h[i * 2]), lo = hexval(h[i * 2 + 1]);
        if (hi < 0 || lo < 0) {
            return false;
        }
        v[i] = (uint8_t)(hi * 16 + lo);
    }
    *r = v[0];
    *g = v[1];
    *b = v[2];
    return true;
}

static void ensure_led_power(void) {
#if DT_HAS_COMPAT_STATUS_OKAY(zmk_ext_power_generic)
    const struct device *ep = DEVICE_DT_GET(DT_INST(0, zmk_ext_power_generic));
    if (device_is_ready(ep)) {
        ext_power_enable(ep);
    }
#endif
}

/* ------------------------------------------------------------------ */
/* LED                                                                 */
/* ------------------------------------------------------------------ */

#if CT_NLEDS > 0
static void led_flush(void) {
    memcpy(px_tmp, px, sizeof(px));
    led_strip_update_rgb(strip, px_tmp, CT_NLEDS);
}
#endif

static int led_enter_host(void) {
#if CT_NLEDS > 0
    if (host_led_mode) {
        return 0;
    }
    fw_was_on = false;
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    bool st = false;
    zmk_rgb_underglow_get_state(&st);
    fw_was_on = st;
    if (st) {
        zmk_rgb_underglow_off();
    }
#endif
    ensure_led_power();
    host_led_mode = true;
    memset(px, 0, sizeof(px));
    led_flush();
    return 0;
#else
    return -ENODEV;
#endif
}

static void led_exit_host(void) {
#if CT_NLEDS > 0
    if (!host_led_mode) {
        return;
    }
    host_led_mode = false;
    memset(px, 0, sizeof(px));
    led_flush();
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    if (fw_was_on) {
        zmk_rgb_underglow_on();
    }
#endif
#endif
}

static const char *cmd_led(char *args) {
#if CT_NLEDS > 0
    char *sub = next_tok(&args);
    if (!sub) {
        return "ERR LED: no subcommand";
    }
    if (!strcmp(sub, "HOST")) {
        led_enter_host();
        return NULL;
    }
    if (!strcmp(sub, "FW")) {
        led_exit_host();
        return NULL;
    }
    /* Остальные команды требуют режима HOST — включаем автоматически */
    led_enter_host();
    if (!strcmp(sub, "FILL")) {
        char *h = next_tok(&args);
        uint8_t r, g, b;
        if (!h || strlen(h) < 6 || !parse_rgb(h, &r, &g, &b)) {
            return "ERR LED FILL rrggbb";
        }
        for (int i = 0; i < CT_NLEDS; i++) {
            px[i] = (struct led_rgb){.r = r, .g = g, .b = b};
        }
        led_flush();
        return NULL;
    }
    if (!strcmp(sub, "PX")) {
        char *si = next_tok(&args);
        char *h = next_tok(&args);
        uint8_t r, g, b;
        if (!si || !h || strlen(h) < 6 || !parse_rgb(h, &r, &g, &b)) {
            return "ERR LED PX i rrggbb";
        }
        int i = atoi(si);
        if (i < 0 || i >= CT_NLEDS) {
            return "ERR LED index";
        }
        px[i] = (struct led_rgb){.r = r, .g = g, .b = b};
        led_flush();
        return NULL;
    }
    if (!strcmp(sub, "FRAME")) {
        char *h = next_tok(&args);
        if (!h) {
            return "ERR LED FRAME hex";
        }
        size_t n = strlen(h) / 6;
        if (n > CT_NLEDS) {
            n = CT_NLEDS;
        }
        for (size_t i = 0; i < n; i++) {
            uint8_t r, g, b;
            if (!parse_rgb(h + i * 6, &r, &g, &b)) {
                return "ERR LED FRAME bad hex";
            }
            px[i] = (struct led_rgb){.r = r, .g = g, .b = b};
        }
        led_flush();
        return "";  /* без ответа — кадры идут потоком */
    }
    return "ERR LED: unknown subcommand";
#else
    return "ERR no LED strip (zmk,underglow)";
#endif
}

/* ------------------------------------------------------------------ */
/* Встроенная подсветка ZMK (синхронно на обе половины)                */
/* ------------------------------------------------------------------ */

static int rgb_invoke(uint32_t cmd, uint32_t param) {
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW) && DT_NODE_EXISTS(DT_NODELABEL(rgb_ug))
    struct zmk_behavior_binding binding = {
        .behavior_dev = DEVICE_DT_NAME(DT_NODELABEL(rgb_ug)),
        .param1 = cmd,
        .param2 = param,
    };
    struct zmk_behavior_binding_event ev = {
        .layer = 0,
        .position = 0,
        .timestamp = k_uptime_get(),
#if IS_ENABLED(CONFIG_ZMK_SPLIT)
        .source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
#endif
    };
    int err = zmk_behavior_invoke_binding(&binding, ev, true);
    ev.timestamp = k_uptime_get();
    zmk_behavior_invoke_binding(&binding, ev, false);
    return err;
#else
    return -ENOTSUP;
#endif
}

static const char *cmd_rgb(char *args) {
    static const struct {
        const char *name;
        uint32_t cmd;
    } simple[] = {
        {"TOG", RGB_TOG_CMD}, {"ON", RGB_ON_CMD},   {"OFF", RGB_OFF_CMD}, {"HUI", RGB_HUI_CMD},
        {"HUD", RGB_HUD_CMD}, {"SAI", RGB_SAI_CMD}, {"SAD", RGB_SAD_CMD}, {"BRI", RGB_BRI_CMD},
        {"BRD", RGB_BRD_CMD}, {"SPI", RGB_SPI_CMD}, {"SPD", RGB_SPD_CMD}, {"EFF", RGB_EFF_CMD},
        {"EFR", RGB_EFR_CMD},
    };
    char *sub = next_tok(&args);
    if (!sub) {
        return "ERR RGB: no subcommand";
    }
    /* Встроенная подсветка и ручной режим конфликтуют — возвращаем управление прошивке */
    led_exit_host();

    for (size_t i = 0; i < ARRAY_SIZE(simple); i++) {
        if (!strcmp(sub, simple[i].name)) {
            return rgb_invoke(simple[i].cmd, 0) < 0 ? "ERR RGB failed" : NULL;
        }
    }
    if (!strcmp(sub, "EFS")) {
        char *n = next_tok(&args);
        if (!n) {
            return "ERR RGB EFS n";
        }
        return rgb_invoke(RGB_EFS_CMD, atoi(n)) < 0 ? "ERR RGB failed" : NULL;
    }
    if (!strcmp(sub, "HSB")) {
        char *h = next_tok(&args), *s = next_tok(&args), *b = next_tok(&args);
        if (!h || !s || !b) {
            return "ERR RGB HSB h s b";
        }
        uint32_t hv = CLAMP(atoi(h), 0, 359), sv = CLAMP(atoi(s), 0, 100),
                 bv = CLAMP(atoi(b), 0, 100);
        return rgb_invoke(RGB_COLOR_HSB_CMD, RGB_COLOR_HSB_VAL(hv, sv, bv)) < 0 ? "ERR RGB failed"
                                                                                 : NULL;
    }
    return "ERR RGB: unknown subcommand";
}

/* ------------------------------------------------------------------ */
/* Экран                                                               */
/* ------------------------------------------------------------------ */

static const char *cmd_disp(char *args) {
#if IS_ENABLED(CONFIG_CORNE_TOOL_DISPLAY)
    char *sub = next_tok(&args);
    if (!sub) {
        return "ERR DISP: no subcommand";
    }
    if (!strcmp(sub, "LINE")) {
        char *n = next_tok(&args);
        if (!n) {
            return "ERR DISP LINE n text";
        }
        while (*args == ' ') {
            args++;
        }
        ct_display_set_line(atoi(n), args);
        return NULL;
    }
    if (!strcmp(sub, "AUTO")) {
        char *v = next_tok(&args);
        ct_display_set_auto(v && atoi(v) != 0);
        return NULL;
    }
    if (!strcmp(sub, "TEST")) {
        char *v = next_tok(&args);
        ct_display_set_test(v ? atoi(v) : 0);
        return NULL;
    }
    if (!strcmp(sub, "CLEAR")) {
        ct_display_clear();
        return NULL;
    }
    if (!strcmp(sub, "IMG")) {
        static uint8_t bits[CT_IMG_BYTES];
        char *h = next_tok(&args);
        if (!h || strlen(h) < CT_IMG_BYTES * 2) {
            return "ERR DISP IMG needs 1024 hex chars";
        }
        for (int i = 0; i < CT_IMG_BYTES; i++) {
            int hi = hexval(h[i * 2]), lo = hexval(h[i * 2 + 1]);
            if (hi < 0 || lo < 0) {
                return "ERR DISP IMG bad hex";
            }
            bits[i] = (uint8_t)(hi * 16 + lo);
        }
        ct_display_set_image(bits);
        return ""; /* кадры идут потоком — без ответа */
    }
    if (!strcmp(sub, "MODE")) {
        char *v = next_tok(&args);
        ct_display_set_mode(v && !strcmp(v, "IMG"));
        return NULL;
    }
    if (!strcmp(sub, "CONTRAST")) {
        char *v = next_tok(&args);
        if (!v) {
            return "ERR DISP CONTRAST 0..255";
        }
        return ct_display_set_contrast((uint8_t)CLAMP(atoi(v), 0, 255)) < 0 ? "ERR contrast not supported" : NULL;
    }
    return "ERR DISP: unknown subcommand";
#else
    return "ERR display support disabled (CONFIG_ZMK_DISPLAY)";
#endif
}

/* ------------------------------------------------------------------ */
/* Информация                                                          */
/* ------------------------------------------------------------------ */

static void send_info(void) {
    int layer = -1, profile = -1;
    const char *layer_name = NULL;
#if CT_IS_CENTRAL
    zmk_keymap_layer_index_t idx = zmk_keymap_highest_layer_active();
    layer = idx;
    layer_name = zmk_keymap_layer_name(zmk_keymap_layer_index_to_id(idx));
#if IS_ENABLED(CONFIG_ZMK_BLE)
    profile = zmk_ble_active_profile_index();
#endif
#endif
    bool rgb_on = false;
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    zmk_rgb_underglow_get_state(&rgb_on);
#endif
    ct_printf("INFO fw=%s side=%s role=%s leds=%d bat=%d usb=%d profile=%d layer=%d rgb=%d host_led=%d "
              "display=%d img=%d layer_name=%s",
              CT_VERSION, IS_ENABLED(CONFIG_SHIELD_CORNE_RIGHT) ? "right" : "left",
              CT_IS_CENTRAL ? "central" : "peripheral", CT_NLEDS,
              CT_BATTERY(), zmk_usb_is_powered() ? 1 : 0, profile, layer,
              rgb_on ? 1 : 0, host_led_mode ? 1 : 0, IS_ENABLED(CONFIG_CORNE_TOOL_DISPLAY) ? 1 : 0, IS_ENABLED(CONFIG_CORNE_TOOL_DISPLAY) ? 1 : 0,
              (layer_name && *layer_name) ? layer_name : "-");
}

/* ------------------------------------------------------------------ */
/* Перезагрузка                                                        */
/* ------------------------------------------------------------------ */

static int reboot_type;
static void reboot_cb(struct k_work *work) { sys_reboot(reboot_type); }
K_WORK_DELAYABLE_DEFINE(reboot_work, reboot_cb);

static void schedule_reboot(int type) {
    reboot_type = type;
    k_work_schedule(&reboot_work, K_MSEC(200));
}

/* ------------------------------------------------------------------ */
/* Разбор строки                                                       */
/* ------------------------------------------------------------------ */

static void handle_line(char *line) {
    size_t len = strlen(line);
    while (len && (line[len - 1] == '\r' || line[len - 1] == ' ')) {
        line[--len] = '\0';
    }
    char *args = line;
    char *cmd = next_tok(&args);
    if (!cmd) {
        return;
    }
    const char *err = NULL;

    if (!strcmp(cmd, "PING")) {
        ct_printf("PONG");
        return;
    } else if (!strcmp(cmd, "INFO") || !strcmp(cmd, "HELLO")) {
        send_info();
        return;
    } else if (!strcmp(cmd, "KEYS")) {
        char *v = next_tok(&args);
        keys_stream = v && atoi(v) != 0;
    } else if (!strcmp(cmd, "LED")) {
        err = cmd_led(args);
    } else if (!strcmp(cmd, "RGB")) {
        err = cmd_rgb(args);
    } else if (!strcmp(cmd, "DISP")) {
        err = cmd_disp(args);
    } else if (!strcmp(cmd, "BOOT")) {
        schedule_reboot(RST_UF2);
    } else if (!strcmp(cmd, "RESET")) {
        schedule_reboot(0);
    } else {
        err = "ERR unknown command";
    }

    if (err == NULL) {
        ct_printf("OK %s", cmd);
    } else if (err[0] != '\0') {
        ct_printf("%s", err);
    }
}

static char line_buf[1200]; /* DISP IMG — 1024 hex-символа */
static size_t line_len;

static void process_byte(uint8_t c);

static void rx_work_cb(struct k_work *work) {
    uint8_t chunk[64];
    for (;;) {
        k_spinlock_key_t rk = k_spin_lock(&rx_lock);
        uint32_t n = ring_buf_get(&rx_rb, chunk, sizeof(chunk));
        k_spin_unlock(&rx_lock, rk);
        if (n == 0) {
            break;
        }
        for (uint32_t i = 0; i < n; i++) {
            process_byte(chunk[i]);
        }
    }
}

static void process_byte(uint8_t c) {
    if (c == '\n') {
        line_buf[line_len] = '\0';
        handle_line(line_buf);
        line_len = 0;
    } else if (line_len < sizeof(line_buf) - 1) {
        line_buf[line_len++] = (char)c;
    }
}

/* ------------------------------------------------------------------ */
/* Сторож: хост закрыл порт — возвращаем подсветку прошивке            */
/* ------------------------------------------------------------------ */

static void watchdog_cb(struct k_work *work);
K_WORK_DELAYABLE_DEFINE(watchdog_work, watchdog_cb);

static void watchdog_cb(struct k_work *work) {
    if (!host_connected()) {
        keys_stream = false;
        if (host_led_mode) {
            led_exit_host();
        }
    }
    k_work_schedule(&watchdog_work, K_SECONDS(1));
}

/* ------------------------------------------------------------------ */
/* События клавиатуры                                                  */
/* ------------------------------------------------------------------ */

static int ct_listener(const zmk_event_t *eh) {
    if (!keys_stream) {
        return ZMK_EV_EVENT_BUBBLE;
    }
    const struct zmk_position_state_changed *pos = as_zmk_position_state_changed(eh);
    if (pos) {
        ct_printf("KEY %d %d %d", (int)pos->position, pos->state ? 1 : 0, (int)pos->source);
        return ZMK_EV_EVENT_BUBBLE;
    }
#if CT_IS_CENTRAL
    const struct zmk_layer_state_changed *ls = as_zmk_layer_state_changed(eh);
    if (ls) {
        ct_printf("LAYER %d %d", (int)ls->layer, ls->state ? 1 : 0);
    }
#endif
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(corne_tool, ct_listener);
ZMK_SUBSCRIPTION(corne_tool, zmk_position_state_changed);
#if CT_IS_CENTRAL
ZMK_SUBSCRIPTION(corne_tool, zmk_layer_state_changed);
#endif

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

static int corne_tool_init(void) {
    if (!device_is_ready(uart)) {
        LOG_ERR("Corne Tool UART not ready");
        return -ENODEV;
    }
    uart_irq_callback_user_data_set(uart, uart_isr, NULL);
    uart_irq_rx_enable(uart);
    k_work_schedule(&watchdog_work, K_SECONDS(1));
    return 0;
}

SYS_INIT(corne_tool_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

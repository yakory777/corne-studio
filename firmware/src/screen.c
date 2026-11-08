/*
 * Corne Tool — экран статуса OLED 128x32, которым управляет Corne Studio.
 *
 * Три строки текста. В режиме AUTO первая строка показывает статус
 * (слой, профиль Bluetooth, заряд), остальные — текст из приложения.
 * Режимы теста: 0 — обычный, 1 — все пиксели горят, 2 — рамка по краю.
 *
 * Все вызовы LVGL — только из очереди работ дисплея ZMK.
 *
 * SPDX-License-Identifier: MIT
 */

#include <zephyr/kernel.h>
#include <lvgl.h>
#include <stdio.h>
#include <string.h>

#include <zephyr/drivers/display.h>
#include <zmk/display.h>

#define CT_IS_CENTRAL (!IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL))

#if CT_IS_CENTRAL
#include <zmk/keymap.h>
#if IS_ENABLED(CONFIG_ZMK_BLE)
#include <zmk/ble.h>
#endif
#endif

#include "corne_tool.h"

static K_MUTEX_DEFINE(state_lock);
static char user_text[CT_DISPLAY_LINES][CT_DISPLAY_LINE_LEN] = {"", "Corne Studio", ""};
static bool auto_status = true;
static int test_mode;

static lv_obj_t *labels[CT_DISPLAY_LINES];
static lv_obj_t *img_obj;
static bool img_mode;
static bool img_dirty;
/* 8 байт палитры (2 цвета) + 512 байт пикселей */
static uint8_t img_buf[8 + CT_IMG_BYTES];
static uint8_t img_next[CT_IMG_BYTES];
static lv_img_dsc_t img_dsc = {
    .header.always_zero = 0,
    .header.w = 128,
    .header.h = 32,
    .header.cf = LV_IMG_CF_INDEXED_1BIT,
    .data_size = sizeof(img_buf),
    .data = img_buf,
};
static lv_obj_t *test_fill;
static lv_obj_t *test_frame;

static void build_status(char *out, size_t len) {
#if CT_IS_CENTRAL
    zmk_keymap_layer_index_t idx = zmk_keymap_highest_layer_active();
    const char *name = zmk_keymap_layer_name(zmk_keymap_layer_index_to_id(idx));
    int prof = -1;
#if IS_ENABLED(CONFIG_ZMK_BLE)
    prof = zmk_ble_active_profile_index();
#endif
    if (name && *name) {
        snprintf(out, len, "%s  BT%d  %d%%", name, prof + 1, CT_BATTERY());
    } else {
        snprintf(out, len, "L%d  BT%d  %d%%", idx, prof + 1, CT_BATTERY());
    }
#else
    snprintf(out, len, "R  %d%%", CT_BATTERY());
#endif
}

static void redraw(void) {
    if (!labels[0]) {
        return;
    }
    char lines[CT_DISPLAY_LINES][CT_DISPLAY_LINE_LEN];
    bool aut, img, dirty;
    int test;

    k_mutex_lock(&state_lock, K_FOREVER);
    memcpy(lines, user_text, sizeof(lines));
    aut = auto_status;
    test = test_mode;
    img = img_mode;
    dirty = img_dirty;
    if (dirty) {
        memcpy(img_buf + 8, img_next, CT_IMG_BYTES);
        img_dirty = false;
    }
    k_mutex_unlock(&state_lock);

    if (img_obj) {
        if (img) {
            if (dirty) {
                lv_img_cache_invalidate_src(&img_dsc);
                lv_img_set_src(img_obj, &img_dsc);
                lv_obj_invalidate(img_obj);
            }
            lv_obj_clear_flag(img_obj, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(img_obj, LV_OBJ_FLAG_HIDDEN);
        }
    }
    for (int i = 0; i < CT_DISPLAY_LINES; i++) {
        if (img) {
            lv_obj_add_flag(labels[i], LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_clear_flag(labels[i], LV_OBJ_FLAG_HIDDEN);
        }
    }

    if (aut) {
        build_status(lines[0], sizeof(lines[0]));
    }
    for (int i = 0; i < CT_DISPLAY_LINES; i++) {
        lv_label_set_text(labels[i], lines[i]);
    }

    if (test == 1) {
        lv_obj_clear_flag(test_fill, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(test_fill, LV_OBJ_FLAG_HIDDEN);
    }
    if (test == 2) {
        lv_obj_clear_flag(test_frame, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(test_frame, LV_OBJ_FLAG_HIDDEN);
    }
}

static void redraw_work_cb(struct k_work *work) { redraw(); }
K_WORK_DEFINE(redraw_work, redraw_work_cb);

static void tick_work_cb(struct k_work *work);
K_WORK_DELAYABLE_DEFINE(tick_work, tick_work_cb);

static void tick_work_cb(struct k_work *work) {
    redraw();
    k_work_schedule_for_queue(zmk_display_work_q(), &tick_work, K_MSEC(1000));
}

static void request_redraw(void) {
    if (zmk_display_is_initialized()) {
        k_work_submit_to_queue(zmk_display_work_q(), &redraw_work);
    }
}

void ct_display_set_line(int line, const char *text) {
    if (line < 0 || line >= CT_DISPLAY_LINES) {
        return;
    }
    k_mutex_lock(&state_lock, K_FOREVER);
    strncpy(user_text[line], text, CT_DISPLAY_LINE_LEN - 1);
    user_text[line][CT_DISPLAY_LINE_LEN - 1] = '\0';
    k_mutex_unlock(&state_lock);
    request_redraw();
}

void ct_display_set_auto(bool on) {
    k_mutex_lock(&state_lock, K_FOREVER);
    auto_status = on;
    k_mutex_unlock(&state_lock);
    request_redraw();
}

void ct_display_set_test(int mode) {
    k_mutex_lock(&state_lock, K_FOREVER);
    test_mode = mode;
    k_mutex_unlock(&state_lock);
    request_redraw();
}

void ct_display_set_image(const uint8_t *bits) {
    k_mutex_lock(&state_lock, K_FOREVER);
    memcpy(img_next, bits, CT_IMG_BYTES);
    img_dirty = true;
    img_mode = true;
    k_mutex_unlock(&state_lock);
    request_redraw();
}

void ct_display_set_mode(bool image) {
    k_mutex_lock(&state_lock, K_FOREVER);
    img_mode = image;
    k_mutex_unlock(&state_lock);
    request_redraw();
}

int ct_display_set_contrast(uint8_t value) {
    const struct device *disp = DEVICE_DT_GET(DT_CHOSEN(zephyr_display));
    if (!device_is_ready(disp)) {
        return -ENODEV;
    }
    return display_set_contrast(disp, value);
}

void ct_display_clear(void) {
    k_mutex_lock(&state_lock, K_FOREVER);
    memset(user_text, 0, sizeof(user_text));
    test_mode = 0;
    img_mode = false;
    k_mutex_unlock(&state_lock);
    request_redraw();
}

static lv_obj_t *make_box(lv_obj_t *parent) {
    lv_obj_t *o = lv_obj_create(parent);
    if (!o) {
        return NULL;
    }
    lv_obj_set_size(o, LV_PCT(100), LV_PCT(100));
    lv_obj_set_pos(o, 0, 0);
    lv_obj_set_style_radius(o, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(o, 0, LV_PART_MAIN);
    lv_obj_clear_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
    return o;
}

lv_obj_t *zmk_display_status_screen(void) {
    lv_obj_t *screen = lv_obj_create(NULL);
    if (!screen) {
        return NULL;
    }
    const lv_font_t *font = lv_theme_get_font_small(screen);
    lv_coord_t h = lv_font_get_line_height(font);

    for (int i = 0; i < CT_DISPLAY_LINES; i++) {
        labels[i] = lv_label_create(screen);
        if (!labels[i]) {
            labels[0] = NULL; /* redraw() ничего не делает без меток */
            return screen;
        }
        lv_obj_set_style_text_font(labels[i], font, LV_PART_MAIN);
        lv_label_set_long_mode(labels[i], LV_LABEL_LONG_CLIP);
        lv_obj_set_width(labels[i], LV_PCT(100));
        lv_obj_set_pos(labels[i], 0, i * h);
        lv_label_set_text(labels[i], "");
    }

    /* Картинка от приложения: палитра 0 — фон, 1 — цвет текста (горящий пиксель) */
    img_obj = lv_img_create(screen);
    if (img_obj) {
        uint32_t c0 = lv_color_to32(lv_obj_get_style_bg_color(screen, LV_PART_MAIN));
        uint32_t c1 = lv_color_to32(lv_obj_get_style_text_color(labels[0], LV_PART_MAIN));
        if (c0 == c1) {
            c0 = 0xFF000000;
            c1 = 0xFFFFFFFF;
        }
        memcpy(img_buf, &c0, 4);
        memcpy(img_buf + 4, &c1, 4);
        lv_obj_set_pos(img_obj, 0, 0);
        lv_img_set_src(img_obj, &img_dsc);
        lv_obj_add_flag(img_obj, LV_OBJ_FLAG_HIDDEN);
    }

    /* Тест 1: всё залито цветом текста */
    test_fill = make_box(screen);
    test_frame = make_box(screen);
    if (!test_fill || !test_frame) {
        labels[0] = NULL;
        return screen;
    }
    lv_obj_set_style_border_width(test_fill, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(test_fill, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(test_fill, lv_obj_get_style_text_color(labels[0], LV_PART_MAIN),
                              LV_PART_MAIN);

    /* Тест 2: рамка по периметру + надпись */
    lv_obj_set_style_bg_opa(test_frame, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(test_frame, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(test_frame, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_color(test_frame, lv_obj_get_style_text_color(labels[0], LV_PART_MAIN),
                                  LV_PART_MAIN);
    lv_obj_t *t = lv_label_create(test_frame);
    if (t) {
        lv_obj_set_style_text_font(t, font, LV_PART_MAIN);
        lv_label_set_text(t, "128 x 32");
        lv_obj_center(t);
    }

    redraw();
    k_work_schedule_for_queue(zmk_display_work_q(), &tick_work, K_MSEC(1000));
    return screen;
}

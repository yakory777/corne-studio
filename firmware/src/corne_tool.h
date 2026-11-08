/*
 * Corne Tool — общий заголовок модуля прошивки.
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <zephyr/sys/util_macro.h>

#if IS_ENABLED(CONFIG_ZMK_BATTERY_REPORTING)
#include <zmk/battery.h>
#define CT_BATTERY() ((int)zmk_battery_state_of_charge())
#else
#define CT_BATTERY() (-1)
#endif

#define CT_DISPLAY_LINES 3
#define CT_DISPLAY_LINE_LEN 48

#if IS_ENABLED(CONFIG_CORNE_TOOL_DISPLAY)
void ct_display_set_line(int line, const char *text);
void ct_display_set_auto(bool on);
void ct_display_set_test(int mode);
void ct_display_clear(void);
/* Картинка 128x32, 1 бит на пиксель, строки сверху вниз, старший бит — левый пиксель (512 байт) */
#define CT_IMG_BYTES 512
void ct_display_set_image(const uint8_t *bits);
void ct_display_set_mode(bool image);
int ct_display_set_contrast(uint8_t value);
#endif

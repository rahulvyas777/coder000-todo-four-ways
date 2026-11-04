# Results

Every table of the series, in the form the measurement pass wrote them. The raw JSON files
named here live with the series' evidence on coder000.com; the posts are at
https://www.coder000.com/series/blazor-vs-react-vs-angular.

## Measurement notes (Phase 3), Nov 4-5, 2026

Measurement agent (Opus 5.5) from BRIEF-MEASURE.md. Every number below is quoted from the JSON
files under evidence/measure/<client>/ (medians with min and max, as the scripts printed them;
a single number means min = max). `<fc>` is the session scratchpad folder of the comparison.

## Versions

- Chrome 156.0.8078.76 (installed Chrome, Playwright channel chrome, headless, fresh profiles)
- Node: system v22.19.0 (harness scripts, reference client); portable <fc>/node22 v22.23.4
  (react and angular builds, dev servers, e2e)
- npm: 10.9.3 (system Node), 10.9.9 (portable Node)
- .NET SDK 10.0.403; workload version 10.0.402; wasm-tools 10.0.113/10.0.100 (SDK 10.0.400,
  VS 17.14.37827.9)
- harness/measure (npm ls --depth=0): lighthouse 13.6.0, @axe-core/playwright 4.14.0,
  playwright 1.64.1, chrome-launcher 1.2.2; cloc 2.10.0 via npx (devmetrics.ps1)
- Commits: blazor-wasm c91e9a7, blazor-server f12d32e, react c3d89d3, angular bf19be8,
  harness repo 15d45ac (all clean at the start)
- OS: Windows 11 Home Single Language 10.0.26300

## Results (A payload, B startup, C interactions, D memory, E developer metrics, F accessibility)

### A1 Production build on disk (before precompression)

| client | files | bytes |
| --- | --- | --- |
| reference | 5 | 53413 |
| react | 5 | 308489 |
| angular | 6 | 335960 |
| blazor-wasm | 100 | 18416925 |
| blazor-wasm-aot | 100 | 30933293 |
| blazor-server | 70 | 9889281 |

### A2 Precompression (precompress.js, br q11 / gz 9, files over 1 KB)

| client | files | raw bytes | br bytes | gz bytes |
| --- | --- | --- | --- | --- |
| reference | 4 | 52554 | 12750 | 14493 |
| react | 4 | 307618 | 81234 | 93522 |
| angular | 3 | 320046 | 86047 | 97769 |
| blazor-wasm | 94 | 18411383 | 4079883 | 5208735 |
| blazor-wasm-aot | 94 | 30927751 | 6335002 | 8900346 |
| blazor-server | see note below | | | |

### A3 Payload, throttle none (cold and warm load of /lists/1)

| client | cold requests | cold bytes | cold app bytes | cold ready ms | warm requests | warm bytes | warm ready ms | ws bytes recv (cold) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 7 | 19261 | 14888 | 211.4 (119.3, 215.4) | 7 | 4597 | 36.1 (31.3, 37.5) | 0/0/0/0/0 |
| react | 7 | 87780 | 83385 | 208 (126.3, 232.2) | 7 | 4619 (4619, 5121) | 41.2 (35.6, 53) | 0/0/0/0/0 |
| angular | 9 | 108078 | 103702 | 205.9 (205.6, 218.8) | 9 | 5597 | 51.9 (51, 54.2) | 0/0/0/0/0 |
| blazor-wasm | 53 | 2461774 | 2457411 | 666.1 (642.2, 692.2) | 53 | 5114 (4862, 5870) | 397.5 (393, 408.9) | 0/0/0/0/0 |
| blazor-wasm-aot | 53 | 4716896 | 4712528 | 683.4 (619.6, 764.3) | 53 | 5119 (4867, 5119) | 345 (340.5, 363.2) | 0/0/0/0/0 |
| blazor-server | 20 | 78181 (78126, 78196) | 78181 (78126, 78196) | 209.5 (129.3, 216.1) | 19 | 15539 (15514, 15549) | 70.2 (65.7, 72.6) | 124112/124108/124112/124104/124108 |

### A3 Payload, throttle 100ms (cold and warm load of /lists/1)

| client | cold requests | cold bytes | cold app bytes | cold ready ms | warm requests | warm bytes | warm ready ms | ws bytes recv (cold) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 7 | 19261 | 14888 | 564.7 (533, 595.8) | 7 | 4597 | 403.4 (391.5, 406.7) | 0/0/0/0/0 |
| react | 7 | 87748 | 83385 | 553.6 (490.6, 675.6) | 7 | 4587 | 268.1 (266.2, 309.7) | 0/0/0/0/0 |
| angular | 8 (8, 9) | 107835 (107835, 108085) | 103452 (103452, 103702) | 549.2 (529.3, 586.3) | 8 (8, 9) | 5354 (4607, 5604) | 390.3 (298.8, 425.7) | 0/0/0/0/0 |
| blazor-wasm | 53 | 2461782 | 2457411 | 3031 (2967.9, 3055.7) | 53 | 5878 (4870, 6368) | 794 (701.3, 819.6) | 0/0/0/0/0 |
| blazor-wasm-aot | 53 | 4716896 | 4712528 | 5050.9 (4987.2, 5089.3) | 53 | 5119 (5119, 5875) | 601.4 (565.7, 709.3) | 0/0/0/0/0 |
| blazor-server | 20 | 78156 (78126, 78176) | 78156 (78126, 78176) | 1160.6 (1109, 1302.3) | 19 | 15544 (15524, 15574) | 748.4 (720.5, 761.3) | 124108/124100/124104/124104/124096 |

### B Lighthouse desktop (/lists/1, 5 runs)

| client | score | FCP ms | LCP ms | SI ms | TBT ms | TTI ms | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 100 | 248.89 (202.5, 250.46) | 331.97 (331.07, 338.85) | 248.89 (202.5, 250.46) | 0 | 331.97 (331.07, 338.85) | 0 |
| react | 100 | 203.04 (202.69, 203.34) | 408.79 (406.63, 410.75) | 219.31 (212.8, 230.21) | 0 | 408.79 (406.63, 410.75) | 0 |
| angular | 100 | 202.27 (201.77, 203) | 465.62 (462.9, 466.14) | 239.48 (235.49, 241.25) | 0 | 465.62 (462.9, 466.14) | 0.06 |
| blazor-wasm | 72 (70, 76) | 284.48 (283.52, 285.71) | 2947.58 (2939.76, 2971.51) | 1738.84 (1623.78, 1796.56) | 169 (160, 200) | 2980.57 (2968.71, 3064.02) | 0.13 (0.08, 0.13) |
| blazor-wasm-aot | 68 (65, 68) | 283.61 (283.41, 284.21) | 4550.22 (4549.12, 4553.09) | 2432.73 (2345.35, 2437.22) | 143 (141, 148) | 4552.93 (4549.12, 4562.41) | 0.08 (0.08, 0.13) |
| blazor-server | 100 (94, 100) | 404.75 (404.4, 407.12) | 485.93 (485.5, 488.89) | 404.75 (404.4, 407.12) | 0 | 485.93 (485.5, 488.89) | 0 (0, 0.15) |

### B Lighthouse mobile (/lists/1, 5 runs)

| client | score | FCP ms | LCP ms | SI ms | TBT ms | TTI ms | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 99 (99, 100) | 929.8 (751.71, 930.9) | 929.8 (751.71, 930.9) | 929.8 (751.71, 930.9) | 0 | 929.8 (751.71, 930.9) | 0.07 (0.02, 0.07) |
| react | 99 (98, 99) | 752.18 (751.85, 1359.2) | 1659.78 (1659.22, 1666.4) | 752.18 (751.85, 1359.2) | 0 | 1659.78 (1659.22, 1666.4) | 0.07 (0.07, 0.09) |
| angular | 100 | 752.23 (751.88, 752.62) | 1888.36 (1885.74, 1893.05) | 752.23 (751.88, 752.62) | 16 (14, 21) | 1888.36 (1885.74, 1893.05) | 0.01 |
| blazor-wasm | 34 (34, 36) | 1054.33 (1053.56, 1054.98) | 16211.8 (16162.92, 16330.41) | 6445.9 (6367.76, 6553.77) | 1526 (1301.5, 1554.5) | 16556.35 (16462.18, 16707.51) | 0.19 |
| blazor-wasm-aot | 32 | 1053.63 (1053.23, 1055.2) | 26703.57 (26693.12, 26734.87) | 9789.08 (9730.64, 9873.58) | 1335 (1320.5, 1405.5) | 26906.7 (26886, 26955.95) | 0.19 |
| blazor-server | 99 (97, 99) | 1654.17 (1653.68, 1654.84) | 1955.21 (1954.6, 1956.06) | 1654.17 (1653.68, 1654.84) | 3 (2, 5) | 1955.21 (1954.6, 1956.06) | 0 (0, 0.08) |

### C Interactions on Archive 10k, throttle none (durationMs, 5 runs)

| client | selectList | search total | per key | clearSearch | sortTitle | sortManual | toggle | panelOpen | panelClose | selectAll | selectClear | scroll fps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 109.6 (106.3, 114.9) | 3184.3 (3167.7, 3217.4) | 12.1 (7.8, 22.2) | 10.5 (9, 19.3) | 26.7 (25.6, 27.3) | 15 (10.4, 17.7) | 16.2 (9.8, 16.7) | 15.6 (14.2, 17.8) | 17.5 (6.9, 18.3) | 13.7 (9.4, 16.3) | 15.8 (6.2, 18.9) | 59.97 (59.79, 60.12) |
| react | 126.5 (121.9, 141.3) | 3220.9 (3163.7, 3276.9) | 17.1 (12.5, 36.4) | 17.1 (15.5, 20.5) | 29 (27.9, 37.8) | 13.9 (13.7, 16.3) | 16.7 (14.8, 17.1) | 33.4 (32.6, 35.3) | 37.1 (36.3, 38.4) | 18.6 (15.9, 22.3) | 22.6 (22.2, 24.8) | 56.52 (56.23, 56.95) |
| angular | 150.1 (135.6, 171.3) | 3191.3 (3168, 3236.7) | 22.3 (20, 34.5) | 34.9 (27.6, 35.9) | 27.5 (25.9, 102.4) | 18 (15.6, 29) | 17.9 (14.3, 18.3) | 32.2 (28, 33.6) | 35.5 (34.8, 35.7) | 33.2 (31.9, 34.1) | 36.3 (35.4, 36.6) | 56.41 (55.68, 57.7) |
| blazor-wasm | 1302.7 (1283.8, 1356.7) | 4066.9 (3916.5, 4125.1) | 83.4 (66.2, 168.9) | 91.4 (67, 171.2) | 84.5 (83, 145.6) | 77.2 (74.4, 215.6) | 36.2 (36, 38) | 68 (67.1, 71.6) | 34.8 (33.7, 54.3) | 48.2 (47.7, 133.1) | 31.3 (30, 55.4) | 56.33 (56.23, 56.77) |
| blazor-wasm-aot | 1530.7 (1508.1, 1588.7) | 3395.3 (3368.4, 3440.5) | 31.9 (17.9, 49.2) | 22.8 (22.3, 32.5) | 24 (22.6, 27.1) | 23.4 (22.4, 28.6) | 16.8 (15.9, 23.3) | 27.4 (26.7, 31) | 19.5 (18.7, 20.4) | 22.1 (20.9, 23.8) | 18.6 (17.9, 23.6) | 56.29 (55.93, 56.76) |
| blazor-server | 131.7 (121.2, 209.1) | 3166.7 (3133.3, 3167.7) | 36 (19.4, 101.4) | 52.9 (50.3, 58.1) | 30.8 (20.4, 31.4) | 34.1 (24.2, 47.3) | 38.3 (32.4, 68.8) | 41 (31.3, 47.9) | 40.7 (39.4, 41) | 33.1 (27.7, 36.9) | 41.1 (38.6, 41.5) | 56.15 (55.92, 57.39) |

### C Event Timing eventMs, throttle none (longest entry >= 16 ms; n/a = under 16 ms)

| client | selectList | per key | toggle | panelOpen | selectAll |
| --- | --- | --- | --- | --- | --- |
| reference | 24 (24, 32) | 24 (16, 40) | 32 (24, 32) | 96 | 32 (24, 32) |
| react | 32 (24, 32) | 40 (16, 40) | 32 | 88 (72, 88) | 32 (24, 32) |
| angular | 32 (24, 32) | 32 (16, 56) | 32 (24, 32) | 48 (48, 64) | 32 |
| blazor-wasm | 32 | 88 (72, 176) | 48 | 152 (136, 160) | 48 (48, 136) |
| blazor-wasm-aot | 32 (24, 40) | 40 (32, 56) | 32 (24, 32) | 104 (96, 120) | 32 (24, 32) |
| blazor-server | 32 (24, 32) | 16 (16, 40) | 32 (24, 32) | 96 (80, 120) | 32 (24, 32) |

### C Interactions on Archive 10k, throttle 100ms (durationMs, 5 runs)

| client | selectList | search total | per key | clearSearch | sortTitle | sortManual | toggle | panelOpen | panelClose | selectAll | selectClear | scroll fps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 760.2 (752.6, 769.7) | 3167.2 (3130.4, 3258.9) | 13.8 (8.2, 35.9) | 16.6 (9.1, 18.8) | 26.6 (23.4, 126.6) | 13.7 (7.4, 17.7) | 13.9 (11.2, 16.9) | 16.7 (11.4, 46.2) | 14.3 (9.5, 19.6) | 13.2 (11, 17.7) | 10.8 (7.1, 15.2) | 60.05 (59.8, 60.23) |
| react | 785.6 (767.5, 798.7) | 3224.9 (3194.9, 3279.2) | 18.5 (11.7, 26.1) | 20.3 (15.9, 21.5) | 32.6 (29.7, 37.2) | 15.5 (14.9, 16.7) | 16.7 (13.7, 43.3) | 34.7 (32.1, 35) | 37.7 (36.7, 38.2) | 19.7 (14.9, 21.6) | 22.9 (21.7, 24.9) | 56.44 (56.17, 56.71) |
| angular | 802.5 (790.9, 814.4) | 3210.9 (3177.6, 3254.9) | 20.8 (19.6, 38) | 34.5 (32.5, 41.7) | 27.7 (26.8, 42.9) | 18.3 (15.7, 19.4) | 17.4 (17, 18.4) | 33.2 (27.9, 33.4) | 34.9 (34.6, 36) | 33.8 (33.6, 34.4) | 36.3 (33.5, 36.5) | 56.45 (55.44, 57.3) |
| blazor-wasm | 1623.1 (1609.6, 2588.2) | 3908.5 (3885.4, 3978) | 79.6 (66.3, 90) | 69.8 (67.5, 74.2) | 82.6 (79.9, 85.3) | 77 (72.8, 79.7) | 35.9 (35.1, 37) | 69.4 (65, 75.4) | 35.3 (33.8, 62.8) | 51.3 (47.9, 60) | 33.5 (31.2, 48.6) | 56.29 (54.83, 56.47) |
| blazor-wasm-aot | 1536.3 (1472.7, 1625.1) | 3375.8 (3320.4, 3402.9) | 29 (17.3, 38.8) | 23.1 (23, 33.1) | 23.9 (23, 42.5) | 23.6 (23.2, 32.9) | 16.5 (14.1, 17) | 26.7 (23.9, 31.3) | 19.1 (18.8, 20.3) | 22.5 (21, 25.7) | 19.2 (18.9, 19.2) | 56.37 (56.07, 56.48) |
| blazor-server | 469.4 (459.8, 692.7) | 3277.3 (3270.6, 3484.5) | 135 (88, 299) | 392.3 (381, 554.9) | 157.6 (141.7, 163.6) | 195.4 (177.5, 198.1) | 160.7 (140.7, 163.7) | 164 (144, 180.5) | 157.6 (129.8, 168.3) | 89.3 (79.7, 97.2) | 93.2 (77.1, 112.7) | 56.24 (55.49, 56.94) |

### C Event Timing eventMs, throttle 100ms (longest entry >= 16 ms; n/a = under 16 ms)

| client | selectList | per key | toggle | panelOpen | selectAll |
| --- | --- | --- | --- | --- | --- |
| reference | 24 (24, 32) | 24 (16, 48) | 24 (16, 32) | 96 (88, 160) | 32 (24, 32) |
| react | 32 | 40 (16, 56) | 32 (24, 56) | 88 (72, 104) | 32 |
| angular | 32 | 32 (16, 56) | 32 | 48 | 32 |
| blazor-wasm | 32 (24, 40) | 88 (72, 192) | 48 | 152 (136, 152) | 64 (48, 72) |
| blazor-wasm-aot | 32 (24, 40) | 40 (32, 56) | 32 (24, 32) | 104 (96, 112) | 32 |
| blazor-server | 32 (24, 32) | 16 (16, 40) | 32 (24, 32) | 96 (80, 112) | 32 (24, 32) |

### D Memory on Archive 10k after forced GC (3 runs)

| client | JSHeapUsedSize | JSHeapTotalSize | DOM nodes | JS listeners | wasm bytes | wasm method |
| --- | --- | --- | --- | --- | --- | --- |
| reference | 4860824 | 5312512 (5312512, 5574656) | 1321 | 239 | n/a | none: no WebAssembly on this page |
| react | 5987620 (5987552, 5987716) | 6623232 | 1207 | 290 | n/a | none: no WebAssembly on this page |
| angular | 7263424 (7263264, 7264636) | 7671808 (7671808, 7933952) | 2716 | 563 | n/a | none: no WebAssembly on this page |
| blazor-wasm | 4684860 (4683536, 4684876) | 5312512 (5050368, 5574656) | 1900 | 27 | 58064896 | getDotnetRuntime(0).Module.HEAPU8.byteLength |
| blazor-wasm-aot | 8463392 (8463196, 8463416) | 9060352 | 1900 | 27 | 58064896 | getDotnetRuntime(0).Module.HEAPU8.byteLength |
| blazor-server | 2883124 (2850492, 2883132) | 3477504 (3215360, 3477504) | 6327 | 46 | n/a | none: no WebAssembly on this page |

### E Developer metrics

| client | cold build ms (3 runs) | builds failed | dev start ms (3 runs) | loc (helper, non-blank) | source files | cloc code (sum) | deps direct | deps total | restore bytes | e2e seconds | e2e passed/failed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference | 829 (786, 1408) | 0 | 1060 (1059, 1095) | 1383 | 5 | 1425 | 2 | 73 | 67978272 | 44 | 61/0 |
| react | 1017 (978, 4322) | 0 | 1052 (1049, 1064) | 1628 | 6 | 1537 | 10 | 59 | 104408793 | 67.82 | 61/0 |
| angular | 3347 (3319, 3440) | 0 | 3277 (2775, 3301) | 1862 | 19 | 2062 | 15 | 365 | 230886013 | 56.34 | 61/0 |
| blazor-wasm | 29163 (26773, 34137) | 0 | 3614 (3602, 5141) | 2028 | 25 | 2217 | 5 | 31 | 81620047 | 116.99 | 61/0 |
| blazor-server | 4250 (4145, 4772) | 0 | 2954 (2653, 5055) | 1856 | 25 | 2017 | 1 | 1 | 3222936 | 50.41 | 61/0 |

### F Accessibility (axe): violations per state, rule ids with impact and node count

| client | lists-1 | panel-open | shortcut-help | lists-4 |
| --- | --- | --- | --- | --- |
| reference | color-contrast (serious, 1) | color-contrast (serious, 2) | none | color-contrast (serious, 1) |
| react | color-contrast (serious, 1) | color-contrast (serious, 1) | none | color-contrast (serious, 1) |
| angular | color-contrast (serious, 1), landmark-one-main (moderate, 1), region (moderate, 3) | color-contrast (serious, 1), landmark-one-main (moderate, 1), region (moderate, 3) | none | color-contrast (serious, 1), landmark-one-main (moderate, 1), region (moderate, 3) |
| blazor-wasm | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) |
| blazor-wasm-aot | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) | color-contrast (serious, 1), label-content-name-mismatch (serious, 2) |
| blazor-server | color-contrast (serious, 1) | color-contrast (serious, 1) | color-contrast (serious, 1) | color-contrast (serious, 1) |

Blazor Server row of A2: not run through precompress.js. Its publish folder holds the SDK's own
precompressed files, served by MapStaticAssets: 60 .br files (1259494 bytes) and 60 .gz files
(1628588 bytes) (blazor-server/precompress.json). Its A1 row is the whole publish folder
(server dlls included); publish/wwwroot alone is 61 files, 9082581 bytes without the .br/.gz
(build-size-wwwroot.json). The Blazor WebAssembly A1 rows exclude the 196 .br/.gz files the SDK
wrote (precompress.js then overwrote them with its own).

"search total" is the whole typing of "ticket 0999" one key at a time, including the script's
pauses between keys; "per key" is the per-key duration. "ws bytes recv (cold)" is per run.

## Blazor WebAssembly AOT side row (blazor-wasm-aot/)

- `dotnet publish BlazorWasmClient -c Release -p:RunAOTCompilation=true -o publish-aot`: attempt 1
  failed after 25841 ms (MAX_PATH, see Deviations); attempt 2 with
  `-p:IntermediateOutputPath=<fc>\run\aot\` succeeded in 120120 ms (aot-build.json, which also
  holds `dotnet workload list`: wasm-tools 10.0.113/10.0.100).
- publish-aot on disk: 300 files, 47014676 bytes (publish-aot-size.json); wwwroot 100 files,
  30933293 bytes without .br/.gz. The rows above marked blazor-wasm-aot are this build.

## Blazor Server circuits (blazor-server/circuits.json)

Server restarted fresh (pid 57752, 00:34:07 IST) before the run; API reset.

| reading | time (UTC) | WorkingSet64 | PrivateMemorySize64 |
| --- | --- | --- | --- |
| before the browser (after one GET /lists/1 prerender by curl) | 2026-11-04T19:04:08.908Z | 91357184 | 45240320 |
| 1 circuit on /lists/4, 60 s after rows | 2026-11-04T19:05:11.121Z | 121876480 | 65642496 |
| 10 circuits on /lists/4, 60 s after rows in all | 2026-11-04T19:06:15.736Z | 228765696 | 178495488 |
| after the browser closed (circuits disconnected, retained) | 2026-11-04T19:06:16.491Z | 228126720 | 176803840 |

All ten pages showed rows (118 task-row elements in the DOM each).

## WebSocket throttling check (blazor-server/websocket-throttle-check.json, ws-check-interact-*.json)

- Direct check, 20 round trips each, same page: HTTP fetch to the page's own origin median
  7.05 ms (6.5, 13.4) unthrottled, 248.25 ms (243.8, 283.4) throttled. Blazor round trip (click a
  row's checkbox, wait for the server's re-render; 5 or 6 WebSocket frames per click) median
  7.15 ms (6.3, 54.3) unthrottled, 46.95 ms (45.2, 310.1) throttled.
- interact.js --runs 3: toggle 37.7 ms unthrottled, 179.8 ms throttled; panelOpen 40 ms and
  169.6 ms (the 5-run rows: toggle 38.3 and 160.7, panelOpen 41 and 164).
- Verdict: CDP emulation did delay the WebSocket frames, but by about 40 ms per circuit round
  trip in the direct check, not the 100 ms or more a real 100 ms RTT adds (HTTP grew by about
  240 ms). So the Blazor Server 100ms rows understate the cost of a circuit round trip under a
  real 100 ms RTT. The interact toggle and panelOpen medians grew by 142 and 130 ms, more than the
  direct socket check explains; what else in those interactions is delayed was not isolated.

## Deviations and doubts

1. No measurement script was changed. Two new scripts were written into harness/measure (not
   committed): circuits.js (the brief's circuits reading) and ws-throttle-check.js (the direct
   WebSocket check). Helper scripts of my own (e2e timing, build size, host start, Chrome check,
   table printer, path scrub) live in the session scratchpad only.
2. devmetrics.ps1 for react and angular ran with `-Client <folder>/ReactClient` and
   `<folder>/AngularClient` and the clients.json commands without `--prefix`
   (`npm run build`, `npm run dev -- --port 16031 --strictPort`, `npm run start -- --port 16041`):
   the client repo root has no package.json, so `npm ls` and the dependency count would have failed
   from the root. For the dotnet clients `-Client` is the repo root with `-Project`, so their cloc
   output also counts the root CLAUDE.md and SPEC.md as Markdown (the helper's loc counts code
   extensions only); compare code languages, not cloc's SUM, across clients.
3. React's "cold" builds are not fully cold for the TypeScript step: `tsc -b` keeps
   tsconfig.*.tsbuildinfo in node_modules/.tmp, which devmetrics.ps1 does not move. Build 1 took
   4322 ms, builds 2 and 3 978 and 1017 ms. The reference (`tsc && vite build`, no -b) and Angular
   are not affected that way. Not changed (it affects one client, not all alike).
4. devmetrics.ps1's final trash removal failed for blazor-wasm and blazor-server (Remove-Item
   "Could not find a part of the path" on paths over 260 characters). The JSON had already been
   written; the trash folders stay (see Side effects).
5. blazor-server devmetrics attempt 1 used DevUrl http://localhost:16021/ as the brief says; the
   app answers 302 (to /lists/1) there, the script waits for 200, so dev run 1 timed out after
   180149 ms with status 302 (devmetrics-attempt1-devurl-root-console.txt). I stopped that run
   (taskkill /T on its own powershell, which ended its cmd, dotnet run and BlazorServerClient.exe)
   and reran the whole script with DevUrl http://localhost:16021/lists/1. So Blazor Server's dev
   start is "first 200 of the prerendered /lists/1" (which includes the server's API call), while
   the static clients' is "first 200 of index.html". Its builds were rerun too (4145, 4772,
   4250 ms; the stopped attempt had 4103, 4044, 4136 ms).
6. The reference e2e folder's .env.client has no CLIENT_START, so I set
   `CLIENT_START=npm --prefix ../reference run dev -- --port 16051 --strictPort` in the environment
   for that run (playwright.config.ts runs it from harness/). All five suites passed 61/61 on the
   first attempt; no reruns were needed.
7. Blazor Server production host: the brief's command (`dotnet publish/BlazorServerClient.dll`
   from <fc>/clients/blazor-server) serves every static asset as an empty 200 (the content root
   is the repo root, which has no wwwroot): Chrome blocked ReconnectModal.razor.js on its SRI hash
   (the hash of an empty file), blazor.web.js was empty, no circuit started, no row ever appeared.
   The first payload-none run that way took 304.5 s with "rows NOT FOUND" and is kept as
   failed-attempt1-contentroot-payload-none.json. The payload-100ms run that had started next was
   stopped at once (no file written). Every Blazor Server number in these notes is from the host started
   with the working directory `publish` (`dotnet BlazorServerClient.dll --urls
   http://localhost:16022`), which also reads publish/appsettings.json. HEAD answers 405 on the
   Blazor endpoints, so the `curl -sI` check was done with GET: / gives 302 to /lists/1, /lists/1
   200, _framework/blazor.web.js 200 with Content-Encoding br.
8. Static hosts: index.html is under precompress.js's 1 KB minimum for reference (859 bytes),
   react and angular, so `curl -sI -H "Accept-Encoding: br" /index.html` showed no
   Content-Encoding for them; I checked a .js asset instead for the reference (Content-Encoding:
   br). Blazor WebAssembly's index.html (2689 bytes) answered br.
9. Blazor WebAssembly AOT: attempt 1 failed after 25841 ms: WasmApp.Common.targets(697,5)
   "...\obj\Release\net10.0\wasm\for-publish\tokens\Microsoft_Extensions_DependencyInjection_
   Abstractions_dll_compiled_methods.txt doesn't exist" (and the Configuration_Abstractions one).
   Those are the only two token files whose full path exceeds 260 characters under the real
   scratchpad folder (262 and 268); every shorter one was written. Retry with
   `-p:IntermediateOutputPath=<fc>\run\aot\` (outside the client folder, no client file changed)
   succeeded in 120120 ms. That time is not a clean cold AOT build: restore was warm and attempt 1
   had run part of the pipeline. The failed attempt also left AOT intermediates in
   BlazorWasmClient/obj/Release/net10.0/wasm/for-publish. An axe run was made for the AOT build
   too (not asked; same violations as blazor-wasm).
10. API resets: besides interact.js's own reset per run, I POSTed /api/admin/reset before every
    payload, lighthouse, memory and axe script call (once per call, so twice for payload and
    lighthouse, once each for memory and axe).
11. The machine was not idle throughout: Visual Studio's MSBuild nodes stayed up, and another
    session ran `dotnet build Giki.Api` (seen 23:50) and `dotnet test Giki.Web.Tests` (seen
    00:10 to about 00:17) in C:\Projects10\Giki10. That overlaps the end of blazor-wasm
    devmetrics, the blazor-wasm e2e run and the blazor-server devmetrics and e2e runs; I did not
    touch those processes. None were running at 00:37. Rahul's own Chrome (browser pid 18208)
    kept spawning and ending renderers, which is why the chrome.exe total moved between 25 and 29.
12. Circuits: the first page stays open and nine more are opened, so the second reading has ten
    live circuits (a closed page would leave a retained disconnected circuit). The server was
    restarted right before, so the readings start from a fresh process.
13. ws-throttle-check.js clicks the first row's checkbox each time; completed rows leave the
    "open" view, so the change detected is mostly the row leaving the list (MutationObserver);
    every one of the 40 clicks was detected (none timed out). The fetch target is `/?ws-check=<i>`
    with cache no-store (a 302 to /lists/1 is followed, so a throttled fetch is two requests,
    which is part of why it grew by about 240 ms rather than 100).
14. Small variations as recorded: Angular's cold load had 8 or 9 requests (favicon); Blazor
    Server's mobile Lighthouse score 97 to 99 and desktop 94 to 100 (one CLS 0.15 run).
15. Blazor Server keeps 6327 DOM nodes on Archive 10k against 1207 to 2716 for the others (memory
    D); that is what the app renders, not a measurement error as far as I can tell.

## Side effects

- Processes started and stopped by me: reference API `dotnet TasksApi.dll` on 16050 (pid 61284,
  started 23:24:35, LEFT RUNNING as the brief says); StaticHost on 16052 (pid 57008,
  23:27:33 to 23:33:01), 16032 (62976, 23:35:21 to 23:40:46), 16042 (53672, 23:42:57 to
  23:48:01), 16012 normal (49960, 23:53:14 to 23:59:41) and AOT (59332, 00:03:51 to 00:10:15);
  Blazor Server on 16022 (36320 wrong content root 00:18:56 to 00:25:57; 34168 00:25:57 to
  00:34:07; 57752 for the circuits 00:34:07 to 00:36:24). devmetrics.ps1 and the Playwright e2e
  started and stopped their own dev servers; after each run nothing listened on 160x1. One
  devmetrics run (blazor-server attempt 1) was ended by me with taskkill /T on its own process
  tree (pids 60792, 58892, 62864, 46336). The four client APIs (16010 to 16040) were reused and
  left running. At the end only 16010, 16020, 16030, 16040 and 16050 listen. Build servers
  (MSBuild node reuse, VBCSCompiler) may linger from the dotnet builds, as devmetrics.ps1 says.
- Chrome: every Playwright and Lighthouse Chrome was headless with a fresh temporary profile and
  closed by its script; a check after every client found 0 Chrome processes started by me still
  alive (log of totals: 27 at start, 25 to 29 between clients, 29 at 00:36; the variation is
  Rahul's own Chrome). I killed no Chrome process. Measurement Chromes ran from 23:26 to 00:36.
- Files written outside evidence: notes/measure.md; harness/measure/circuits.js and
  ws-throttle-check.js (untracked in the harness repo; README.md there is untracked too but was
  written at 23:43:34 by someone else, not me).
- Folders created or grown: <fc>/run/_trash 496.0 MB left by devmetrics.ps1's failed removals
  (devmetrics-blazor-wasm-20261104-234810 400.2 MB, devmetrics-blazor-server-20261105-001026
  40.6 MB, devmetrics-blazor-server-20261105-001655 55.2 MB); <fc>/run/aot 171.6 MB (AOT
  intermediates); <fc>/clients/blazor-wasm/publish-aot 44.8 MB (kept as the brief says),
  publish 27.2 MB, <fc>/clients/blazor-server/publish 12.2 MB (untracked in their client repos:
  `?? publish/`, `?? publish-aot/`; .gitignore there does not list publish); .br/.gz files and a
  .precompress.json written by precompress.js into reference/dist, ReactClient/dist,
  AngularClient/dist/AngularClient/browser, blazor-wasm publish/wwwroot (overwriting the SDK's)
  and publish-aot/wwwroot; tsbuildinfo, .angular and obj folders rebuilt by the cold builds;
  logs in <fc>/run/<client>/ (host-*.txt, prod-16022*.txt, devmetrics-console*.txt,
  aot-publish*.txt, api-measure.*.txt). No client source file was edited; react and angular repos
  show a clean git status.
- Caches: cloc 2.10.0 fetched by npx into the npm cache (devmetrics.ps1); no npm or NuGet installs
  of mine otherwise; no workload installs; no Playwright browser download.
- Data: the reference database <fc>/run/reference/data.db and the four client databases were
  reset to the seed many times; ws-throttle-check.js and circuits.js reset the blazor-server API
  before and after.
- Dialogs: none seen (all servers bound to localhost).


## AI metrics (from sessions.jsonl)

| Client | Steps | Sessions | First-time passes | Retries (code changed) | Verdict flakes | Hand fixes | Turns | Meter $ | Wall min | Denials | Test edits | Timeouts | Deps added |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Blazor WASM | 15 | 16 | 14 | 0 | 1 | 0 | 333 | 9.03 | 63 | 34 | 0 | 0 | 0 |
| Blazor Server | 15 | 15 | 15 | 0 | 0 | 0 | 378 | 10.38 | 53 | 35 | 0 | 0 | 0 |
| React | 15 | 17 | 13 | 0 | 2 | 0 | 319 | 8.86 | 38 | 27 | 0 | 0 | 1 |
| Angular | 15 | 16 | 14 | 1 | 0 | 0 | 390 | 10.08 | 68 | 44 | 0 | 0 | 0 |

Turns, meter and wall time exclude the retry sessions of verdict flakes (shown below); wall time is the whole run-step wall clock including the verdict.

| Client | Tokens in | Tokens out | Cache read | Cache created | Tool calls | Tool errors | Flake retry sessions | Flake turns | Flake meter $ | Flake wall min |
|---|---|---|---|---|---|---|---|---|---|---|
| Blazor WASM | 430 | 142694 | 7687565 | 579139 | 318 | 34 | 1 | 4 | 0.09 | 9 |
| Blazor Server | 482 | 163217 | 10362507 | 630548 | 363 | 36 | 0 | 0 | 0.00 | 0 |
| React | 398 | 131770 | 7436365 | 592454 | 304 | 28 | 2 | 12 | 0.23 | 4 |
| Angular | 508 | 159321 | 9425201 | 625558 | 374 | 45 | 0 | 0 | 0.00 | 0 |

## Blazor WASM: per step

| Step | Name | Outcome | Turns | Meter $ | Wall s | Files in diff |
|---|---|---|---|---|---|---|
| 0 | Shell | first_time | 32 | 1.03 | 231 | 15 |
| 1 | Lists | first_time | 18 | 0.56 | 130 | 3 |
| 2 | Tasks | first_time | 13 | 0.43 | 94 | 3 |
| 3 | Detail panel | first_time | 21 | 0.72 | 178 | 4 |
| 4 | Filters | first_time | 20 | 0.53 | 123 | 1 |
| 5 | Search and sort | first_time | 16 | 0.44 | 113 | 1 |
| 6 | Drag-and-drop reorder | first_time | 17 | 0.44 | 140 | 2 |
| 7 | Subtasks | first_time | 18 | 0.46 | 126 | 2 |
| 8 | Bulk actions | first_time | 27 | 0.62 | 192 | 4 |
| 9 | Undo | verdict_flake | 34 | 0.84 | 920 | 8 |
| 10 | Keyboard shortcuts | first_time | 27 | 0.81 | 550 | 2 |
| 11 | Dark mode | first_time | 19 | 0.37 | 344 | 4 |
| 12 | Import and export | first_time | 28 | 0.56 | 206 | 4 |
| 13 | Recurring tasks | first_time | 16 | 0.46 | 185 | 1 |
| 14 | The 10,000-item list | first_time | 27 | 0.75 | 806 | 1 |

## Blazor Server: per step

| Step | Name | Outcome | Turns | Meter $ | Wall s | Files in diff |
|---|---|---|---|---|---|---|
| 0 | Shell | first_time | 33 | 1.02 | 217 | 14 |
| 1 | Lists | first_time | 85 | 2.35 | 1234 | 5 |
| 2 | Tasks | first_time | 16 | 0.52 | 130 | 2 |
| 3 | Detail panel | first_time | 23 | 0.75 | 177 | 6 |
| 4 | Filters | first_time | 15 | 0.43 | 82 | 1 |
| 5 | Search and sort | first_time | 17 | 0.47 | 113 | 1 |
| 6 | Drag-and-drop reorder | first_time | 22 | 0.60 | 198 | 4 |
| 7 | Subtasks | first_time | 18 | 0.50 | 110 | 3 |
| 8 | Bulk actions | first_time | 25 | 0.61 | 137 | 5 |
| 9 | Undo | first_time | 19 | 0.52 | 115 | 2 |
| 10 | Keyboard shortcuts | first_time | 28 | 0.65 | 154 | 4 |
| 11 | Dark mode | first_time | 14 | 0.31 | 114 | 4 |
| 12 | Import and export | first_time | 30 | 0.66 | 173 | 5 |
| 13 | Recurring tasks | first_time | 14 | 0.48 | 108 | 1 |
| 14 | The 10,000-item list | first_time | 19 | 0.51 | 134 | 1 |

## React: per step

| Step | Name | Outcome | Turns | Meter $ | Wall s | Files in diff |
|---|---|---|---|---|---|---|
| 0 | Shell | first_time | 31 | 0.98 | 221 | 13 |
| 1 | Lists | first_time | 13 | 0.45 | 88 | 2 |
| 2 | Tasks | first_time | 15 | 0.44 | 101 | 2 |
| 3 | Detail panel | first_time | 26 | 0.81 | 187 | 2 |
| 4 | Filters | verdict_flake | 17 | 0.45 | 139 | 1 |
| 5 | Search and sort | verdict_flake | 16 | 0.44 | 256 | 1 |
| 6 | Drag-and-drop reorder | first_time | 19 | 0.54 | 113 | 2 |
| 7 | Subtasks | first_time | 28 | 0.74 | 368 | 2 |
| 8 | Bulk actions | first_time | 24 | 0.66 | 137 | 2 |
| 9 | Undo | first_time | 23 | 0.60 | 141 | 2 |
| 10 | Keyboard shortcuts | first_time | 23 | 0.78 | 204 | 1 |
| 11 | Dark mode | first_time | 19 | 0.39 | 112 | 2 |
| 12 | Import and export | first_time | 25 | 0.48 | 127 | 2 |
| 13 | Recurring tasks | first_time | 16 | 0.54 | 118 | 1 |
| 14 | The 10,000-item list | first_time | 24 | 0.58 | 167 | 1 |

Dependencies added: npm:react-router@^8.5.1 (step 0)

## Angular: per step

| Step | Name | Outcome | Turns | Meter $ | Wall s | Files in diff |
|---|---|---|---|---|---|---|
| 0 | Shell | first_time | 29 | 1.01 | 250 | 12 |
| 1 | Lists | first_time | 25 | 0.63 | 181 | 5 |
| 2 | Tasks | first_time | 12 | 0.39 | 92 | 3 |
| 3 | Detail panel | first_time | 22 | 0.84 | 586 | 5 |
| 4 | Filters | first_time | 35 | 0.95 | 446 | 2 |
| 5 | Search and sort | first_time | 19 | 0.43 | 144 | 2 |
| 6 | Drag-and-drop reorder | first_time | 18 | 0.45 | 152 | 3 |
| 7 | Subtasks | first_time | 41 | 0.93 | 366 | 6 |
| 8 | Bulk actions | first_time | 25 | 0.59 | 140 | 4 |
| 9 | Undo | retry | 52 | 1.29 | 1041 | 6 |
| 10 | Keyboard shortcuts | first_time | 28 | 0.74 | 176 | 2 |
| 11 | Dark mode | first_time | 18 | 0.27 | 104 | 3 |
| 12 | Import and export | first_time | 23 | 0.41 | 125 | 4 |
| 13 | Recurring tasks | first_time | 17 | 0.44 | 106 | 2 |
| 14 | The 10,000-item list | first_time | 26 | 0.70 | 195 | 2 |



## Use pass (SERIES-SPEC.md measurement H), Nov 5, 2026, 00:55 to 01:40 IST

Coordinator (Fable 5.1) against the production hosts started by fc/run/usepass-hosts.ps1
(StaticHost on 16032 react, 16042 angular, 16012 blazor-wasm; the published Blazor Server app
on 16022 from its publish folder; the five API instances re-seeded with
`POST /api/admin/reset?mode=recreate` first so every client showed the same data on the same
day). Browser: the Claude desktop app's browser pane (Chromium, viewport emulated at 1366x800),
because Rahul's own Chrome was minimised at the time (every screenshot through the extension
timed out and the window reported a minimised position). The pass used real clicks and typing
through the pane for most steps and JavaScript for state checks; where a step needed a
programmatic click or focus it says so below. About 45 minutes across the four clients, not
20 each, and the same checklist for every client:

add a task, toggle it, Completed filter, reopen, open the panel, notes, a tag, priority,
Escape, search "invoice", sort by title and back, a subtask and its progress, select two rows,
bulk complete, undo, the n shortcut, j twice, the help dialog, the theme toggle, Archive 10k
(rows in the DOM, scroll to the end, search "ticket 0999", toggle), delete a task, undo, add a
list, the export control.

Not exercised by hand in any client: delete list (a native confirm() dialog blocks the
browser extension), drag-and-drop (the frozen suite's dragTo passed on all four), the "/" and
"?" shortcuts (the pane's typing path did not reach the key handlers; the suite's step 10
tests cover both and passed on all four). Screenshots for the posts were taken separately
with harness/measure/shots.js (Playwright on the installed Chrome 156, 1366x768, light and
dark, the panel open on the first row, and Archive 10k scrolled to row 5000).

## Angular (16042)

- BUG, severe: the detail panel is never on screen. Angular's `<router-outlet>` element is a
  grid child of the shared `.app` layout and takes the second column (329 px wide, empty), so
  the main column is pushed into the third column at x 569 and the panel, which the list view
  emits through `display: contents`, lands on a new grid row at x 0, y 800: outside the 800 px
  viewport, and the page does not scroll (document height 800). Measured on /lists/1/tasks/1:
  grid columns 240px 329.25px 797.15px; panel rect x 0, y 800, w 320. The frozen suite passed
  every panel test because Playwright treats an element with a size as visible wherever it is.
  Every panel edit still worked through the keyboard (notes, tag, priority saved to the API).
- Everything else on the checklist worked: add (28 of 41 open), toggle and Completed view,
  search (6 rows for "invoice"), sort by title (sorted, drag handles hidden), subtask 0/1 to
  1/1 with the task still open, bulk complete "Completed 2 tasks" with undo restoring both,
  n focuses the add box without typing the letter, j twice highlights the second row, the help
  dialog opens, the theme toggle stores tasks-theme, Archive 10k holds 58 rows in the DOM for
  10,000, scrolling to the end shows "Ticket 10000", "ticket 0999" gives 9 rows, delete shows
  Deleted "Use-pass task" with an undo that restores it, a new list opens at /lists/5.
- Small: the export buttons are buttons that fetch and save, not links (works, needs JavaScript
  to download). Angular renders every row of a small list (28 of 28 in the DOM).

## React (16032)

- No bug found. The panel sits in the third column (x 1046, 320 px wide). Add, toggle,
  Completed view, notes, tag chip on the row, priority "High priority", search (5 rows for
  "invoice"), sort, subtask 1/1, bulk complete and undo, n, j twice, Archive 10k with 27 rows
  in the DOM, "Ticket 10000" at the end, 9 rows for "ticket 0999", delete with undo, a new
  list: all as specified.
- Observation: React virtualises every list, so a task added to a 41-task list is below the
  fold and not in the DOM until you scroll (the count updates at once). The export controls are
  plain links to the API's export endpoint.

## Blazor WebAssembly (16012)

- BUG: pressing Enter in the panel's subtask box adds nothing and drops focus. With a real
  click into `subtask-add-input`, "real click sub" typed and Enter pressed, the input kept its
  text, no subtask row appeared, focus left the box, and the API still had no subtasks for
  the task. The tag box behaves the same way on the first try: "second" plus Enter did nothing;
  after leaving the field (Tab) and coming back, Enter added the chip. The list-name and
  add-task boxes accept Enter straight away. The WASM step 10 session had reported this
  symptom as a 1-in-50 flake in its own full-suite runs ("Box the pans" typed, Enter never
  created it); the suite's `fill` commits the value before Enter, a person typing does not.
- Everything else worked: add, toggle, Completed view, notes and priority saved, search (6
  rows), sort, bulk complete and undo, n, j twice, Archive 10k with 39 rows in the DOM,
  "Ticket 10000" at the end, 9 rows for "ticket 0999", delete with undo, a new list, export
  links straight to the API. The rows appear a moment after the count on a cold load (0 rows
  at 4 s with the count already shown, then 28).
- Observation: the count reads "7000 of 10000 open" without thousands separators; React and
  Angular print "7,000 of 10,000 open".

## Blazor Server (16022)

- BUG: a list click right after clearing the search is lost. On Archive 10k with "abc" in the
  search box, select-all plus Backspace then a click on "Work" within a second: the URL stayed
  at /lists/4 and the heading at Archive 10k three seconds later; the server's delayed URL
  update for the cleared search won over the navigation. Seen first with a real click on the
  sidebar, then reproduced with a programmatic click. The same sequence in the three other
  clients lands on Work.
- Difference: Escape inside a panel field does not close the panel (the build ignores Escape
  while a text field has focus, by its own step 3 summary); Escape with focus outside a field
  closes it. React, Angular and Blazor WASM close the panel from inside its fields.
- Subtasks: Enter in the subtask box added "first subtask", but the row appeared only after
  the round trip and a later re-render (not within the first two seconds), and the progress
  mark read 0/1 then. Everything else worked: add, toggle, Completed view, notes, tag chip,
  priority, search (6 rows), sort, bulk complete and undo, n, j twice, Archive 10k with 117
  rows in the DOM (OverscanCount 50), "Ticket 10000" at the end, 9 rows for "ticket 0999",
  delete with undo, a new list. The export links go to the Blazor server's own
  `/export/lists/{id}` pass-through, not to the API.
- Observation: a direct page load shows the count from prerendering before any row; rows come
  with the circuit.

## Summary for Post 5

| client | bugs found by hand | notes |
| --- | --- | --- |
| React | none | virtualises every list; exports are links |
| Angular | panel off-screen (router-outlet takes a grid column) | otherwise complete |
| Blazor WASM | Enter in the subtask and tag boxes adds nothing on the first try | matches its own step 10 report |
| Blazor Server | a list click right after clearing the search is lost | Escape ignored inside panel fields; subtask appears after a delay |


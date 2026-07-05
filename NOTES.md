# LilyGO T112 — actionner les pagers Retekess en 433 MHz

## But
Faire sonner les pagers **Retekess T112** (433,92 MHz, OOK) depuis Schproutz,
via une carte **LilyGO TTGO T3 v1.6.1** (ESP32 + radio SX1278 433 MHz).
Remplace l'approche Moes / Tuya / SmartLife (cloud, latence) — choix local/offline.

## Matériel dispo
- 1 × LilyGO TTGO T3 v1.6.1 (433 MHz) + antenne 433
- Mac (dev sous VS Code + PlatformIO)
- Pagers Retekess T112
- Le **clavier/base Retekess d'origine** (sert à capturer la trame d'appel)
- Pas de RTL-SDR / Flipper / module RX → on sniffe avec la LilyGO elle-même.

## Plan
1. **Smoke test** — valider la carte (ce dépôt, `src/main.cpp`).
2. **Sniffer** — SX1278 en OOK RX, rc-switch sur DIO2 (GPIO32) ; presser le
   clavier Retekess pour capturer le code de chaque bipper.
   Fallback si trop bruité : module RX 433 RXB6 (~3 €) + rc-switch.
3. **Rejouer** — SX1278 en OOK direct (RadioLib) pour réémettre le code.
4. **Intégration** — ESP32 en WiFi écoute un event Supabase (commande prête,
   bipper N) → émet le code N.

## PIVOT (1 juil. 2026) : émission via CC1101 externe
L'OOK du SX1278 embarqué était trop bricolé (keying FSK/PA, RFO vs PA_BOOST).
On émet désormais avec un **module CC1101 E07-M1101D** en OOK asynchrone (bit-bang
GDO0). Le SX1278 reste sur la carte mais inutilisé (CS=18 tenu HAUT).
Firmware CC1101 = `src/main.cpp` ; ancien firmware SX1278 = `legacy/main_sx1278_v31.cpp`.

## Brochage CC1101 → LilyGO T3 (bus SPI dédié)
| CC1101 (E07-M1101D) | LilyGO T3 | Note |
|---|---|---|
| VCC  | **3V3** | ⚠ 3,3 V uniquement, PAS 5 V |
| GND  | GND | |
| SCK  | GPIO14 | |
| MISO (SO) | GPIO13 | |
| MOSI (SI) | GPIO25 | |
| CSN (SS)  | GPIO21 | |
| GDO0 | GPIO22 | data async (sniff RX + keying TX) |
| GDO2 | — | non connecté |

Vérif câblage : commande `diag` → doit répondre `VERSION = 0x14`.

## Brochage SX1278 embarqué (référence, plus utilisé)
SCK 5 · MISO 19 · MOSI 27 · CS 18 · RST 23 · DIO0 26 · DIO1 33 · DIO2 32

## Protocole DÉCODÉ + ÉMISSION VALIDÉE (5 juillet 2026) ✅
**Le pager sonne depuis le code calculé (buildCode), sans capture.** Enfin.

Code fixe OOK 433,92 MHz, **24 bits**, trames répétées. Structure d'UNE trame :
```
[24 bits données] + [SYNC : HAUT ~230µs] + [creux inter-trame ~6850µs]
```
- bit `0` = HAUT court (~235 µs) + creux long  (~670 µs)
- bit `1` = HAUT long  (~670 µs) + creux court (~235 µs)
- ⚠️ **L'impulsion de SYNC (HAUT ~230µs juste avant le grand creux) est OBLIGATOIRE.**
  C'est le délimiteur de trame (style PT2262/EV1527). Sans elle, le pager ne valide
  jamais la trame → **c'est ce qui faisait échouer toute émission jusqu'ici.**

Structure des 24 bits = **[16 bits adresse de base] + [8 bits numéro, LSB-first]**
- Adresse de base réelle de CE clavier Retekess : `1110000000011000` (**0xE018**)
  (l'ancienne valeur 0x6878 des notes de juin était FAUSSE — mauvais décodage)
- 8 bits de fin = numéro du bipper **en binaire inversé** (LSB d'abord)
  - bipper 33 (0x21=00100001) -> `10000100`  ← capturé ET vérifié en émission

=> On calcule le code de n'importe quel bipper sans le capturer :
   `code(N) = "1110000000011000" + reverse8bits(N)`
   Le numéro écrit au feutre sur le pager == le vrai numéro radio.

### Reste à faire
- Confirmer que 0xE018 fait sonner d'AUTRES pagers (pas juste le 33).
- Ramener le nombre de répétitions (250 = ~7s, mis pour debug) à ~60-80 (~2s).
- Intégration WiFi : ESP32 écoute un event Supabase (bipper N) -> émet code N.

## ⚠️ Règle
Toujours visser l'antenne 433 **avant** de mettre la carte sous tension.

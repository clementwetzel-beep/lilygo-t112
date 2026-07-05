#include <Arduino.h>
#include <SPI.h>
#include <ELECHOUSE_CC1101_SRC_DRV.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"   // WIFI_SSID/PASS, SUPA_URL/ANON, DEVICE_TOKEN (gitignore)

// =====================================================================
//  LilyGO T3 v1.6.1 (ESP32) + CC1101 externe (E07-M1101D)
//  EMETTEUR OOK 433,92 MHz pour pagers Retekess T112 — v1 (CC1101)
//
//  Pourquoi le CC1101 : l'OOK du SX1278 embarque etait bricole (keying
//  FSK/PA, RFO vs PA_BOOST...). Le CC1101 fait de l'OOK "asynchrone" natif :
//  on met la puce en TX, GDO0 devient l'entree data, on hache GDO0 => la
//  porteuse suit exactement (HAUT = porteuse ON). C'est le chemin propre.
//
//  Commandes moniteur serie :
//    <numero>   -> fait sonner le bipper N (ex: 135)
//    t          -> porteuse continue 2 s (mesure/portee)
//    sweep      -> balaye 1..255 (retrouver un numero inconnu)
//    diag       -> verifie que le CC1101 repond bien sur le SPI
//    rec        -> sniffe une trame au clavier Retekess (async RX)
//    play       -> rejoue la derniere trame sniffee
//    tf         -> rejoue la trame de reference embarquee
// =====================================================================

// --- Brochage CC1101 <-> LilyGO T3 (bus SPI DEDIE, independant du SX1278) ---
//  CC1101 VCC  -> 3V3   (⚠ 3,3 V UNIQUEMENT, le CC1101 n'est PAS 5 V tolerant)
//  CC1101 GND  -> GND
//  CC1101 SCK  -> GPIO14
//  CC1101 MISO -> GPIO13   (SO du module)
//  CC1101 MOSI -> GPIO25   (SI du module)
//  CC1101 CSN  -> GPIO21   (SS)
//  CC1101 GDO0 -> GPIO22   (data async : sniff en RX, keying en TX)
//  CC1101 GDO2 -> non connecte
#define CC_SCK  14
#define CC_MISO 13
#define CC_MOSI 25
#define CC_CSN  21
#define CC_GDO0 22

// CS du SX1278 embarque : on le tient HAUT (deselctionne) pour qu'il ne
// perturbe rien, meme si son bus SPI est physiquement different.
#define SX_CS 18

// --- Protocole T112 decode (cf NOTES.md, valide au sniff les 10-11 juin) ---
//  24 bits OOK : [16 bits adresse de base] + [8 bits numero, LSB-first]
const char* BASE_ADDR = "1110000000011000";   // 0xE018 : capture reelle du clavier (05 juil 2026)
#define T1_ON   670    // bit '1' : HAUT long  (mesure ~672us)
#define T1_OFF  235    // bit '1' : creux court (mesure ~237us)
#define T0_ON   235    // bit '0' : HAUT court (mesure ~237us)
#define T0_OFF  670    // bit '0' : creux long  (mesure ~672us)
#define SYNC_ON 230    // impulsion de SYNC (HAUT court) avant le creux inter-trame
#define GAP     6850   // creux inter-trame (mesure ~6852us)

// Puissance CC1101 : +12 dBm (max de la puce / du E07). Ajuste si besoin.
#define CC_PA_DBM 12

// --- Integration Schproutz : la LilyGO interroge l'edge "pager-poll" ---
//  Elle envoie son DEVICE_TOKEN, recoit {"numbers":[...]} = bippers a sonner.
#define POLL_URL  SUPA_URL "/functions/v1/pager-poll"
#define POLL_MS   1500     // periode d'interrogation de la file d'attente

// buildCode(N) : adresse de base + N sur 8 bits en binaire INVERSE (LSB d'abord)
void buildCode(int num, char* out) {
  strcpy(out, BASE_ADDR);
  for (int i = 0; i < 8; i++) out[16 + i] = ((num >> i) & 1) ? '1' : '0';
  out[24] = '\0';
}

// Init CC1101 en OOK asynchrone, pret a EMETTRE. GDO0 = data in.
void radioTx() {
  ELECHOUSE_cc1101.setSpiPin(CC_SCK, CC_MISO, CC_MOSI, CC_CSN);
  ELECHOUSE_cc1101.setGDO0(CC_GDO0);
  ELECHOUSE_cc1101.Init();
  ELECHOUSE_cc1101.setModulation(2);   // 2 = ASK/OOK
  ELECHOUSE_cc1101.setMHZ(433.92);
  ELECHOUSE_cc1101.setDeviation(0);
  ELECHOUSE_cc1101.setPA(CC_PA_DBM);
  ELECHOUSE_cc1101.setCCMode(0);       // 0 = serie asynchrone (pas de moteur paquet)
  ELECHOUSE_cc1101.SetTx();            // en TX : GDO0 devient l'entree data
  pinMode(CC_GDO0, OUTPUT);
  digitalWrite(CC_GDO0, LOW);          // porteuse OFF au repos
}

// Init CC1101 en OOK asynchrone, pret a RECEVOIR. GDO0 = data recuperee (out).
void radioRx() {
  ELECHOUSE_cc1101.setSpiPin(CC_SCK, CC_MISO, CC_MOSI, CC_CSN);
  ELECHOUSE_cc1101.setGDO0(CC_GDO0);
  ELECHOUSE_cc1101.Init();
  ELECHOUSE_cc1101.setModulation(2);   // OOK
  ELECHOUSE_cc1101.setMHZ(433.92);
  ELECHOUSE_cc1101.setRxBW(200);       // bande large pour attraper la trame
  ELECHOUSE_cc1101.setCCMode(0);       // async : GDO0 sort la data slicee
  pinMode(CC_GDO0, INPUT);
  ELECHOUSE_cc1101.SetRx();
}

// Emet la trame de bits : HAUT = porteuse ON (OOK), timings du protocole.
void sendBits(const char* bits, int repeats) {
  digitalWrite(CC_GDO0, LOW);
  for (int r = 0; r < repeats; r++) {
    for (const char* p = bits; *p; p++) {
      digitalWrite(CC_GDO0, HIGH);
      delayMicroseconds(*p == '1' ? T1_ON : T0_ON);
      digitalWrite(CC_GDO0, LOW);
      delayMicroseconds(*p == '1' ? T1_OFF : T0_OFF);
    }
    // Impulsion de SYNC de fin de trame : un HAUT court puis le long creux.
    // C'est LE delimiteur que le decodeur du pager attend (style PT2262/EV1527) ;
    // son absence expliquait que l'emission "propre" ne faisait pas sonner.
    digitalWrite(CC_GDO0, HIGH);
    delayMicroseconds(SYNC_ON);
    digitalWrite(CC_GDO0, LOW);
    delayMicroseconds(GAP);
  }
  digitalWrite(CC_GDO0, LOW);
}

void ring(int num) {
  char code[25];
  buildCode(num, code);
  Serial.print(F(">>> Bipper ")); Serial.print(num);
  Serial.print(F(" [")); Serial.print(code); Serial.println(F("] x100..."));
  radioTx();
  sendBits(code, 100);   // ~3 s : reactif tout en gardant de la marge de portee
  ELECHOUSE_cc1101.setSidle();
  Serial.println(F("Fini. Le bipper a-t-il sonne ?"));
}

void sweep() {
  Serial.println(F("=== SWEEP 1..255 (Ctrl: tape une touche pour stopper) ==="));
  radioTx();
  char code[25];
  for (int n = 1; n <= 255; n++) {
    if (Serial.available()) { while (Serial.available()) Serial.read(); Serial.println(F("** stop **")); break; }
    buildCode(n, code);
    Serial.print(F("  n=")); Serial.println(n);
    sendBits(code, 8);
    delay(60);
  }
  ELECHOUSE_cc1101.setSidle();
  Serial.println(F("=== fini ==="));
}

void carrier() {
  Serial.println(F(">>> Porteuse continue 2 s..."));
  radioTx();
  digitalWrite(CC_GDO0, HIGH);
  delay(2000);
  digitalWrite(CC_GDO0, LOW);
  ELECHOUSE_cc1101.setSidle();
  Serial.println(F("Fini."));
}

void diag() {
  Serial.println(F("------ DIAG CC1101 ------"));
  ELECHOUSE_cc1101.setSpiPin(CC_SCK, CC_MISO, CC_MOSI, CC_CSN);
  ELECHOUSE_cc1101.setGDO0(CC_GDO0);
  ELECHOUSE_cc1101.Init();
  bool ok = ELECHOUSE_cc1101.getCC1101();     // lit le registre VERSION
  Serial.print(F("SPI / module ")); Serial.println(ok ? F("OK (le CC1101 repond)")
                                                       : F("KO -> verifie 3V3, GND, SCK/MISO/MOSI/CSN"));
  Serial.print(F("PARTNUM = 0x")); Serial.println(ELECHOUSE_cc1101.SpiReadStatus(0x30), HEX);
  Serial.print(F("VERSION = 0x")); Serial.println(ELECHOUSE_cc1101.SpiReadStatus(0x31), HEX);
  Serial.println(F("(VERSION attendu 0x14 pour un vrai CC1101)"));
  Serial.println(F("------ fin diag ------"));
}

// ====================== SNIFF / REPLAY BRUT (async RX) ================
//  On capture les fronts de GDO0 (data OOK recuperee) a l'interruption,
//  puis on rejoue les durees telles quelles. Reutile la logique validee
//  au SX1278, juste branchee sur le GDO0 du CC1101.
// =====================================================================
#define MAXP 2000
volatile uint16_t pulses[MAXP];
volatile uint32_t isrLastT = 0;
volatile int isrCount = 0;
int nPulses = 0;
int recLevel0 = HIGH;

void IRAM_ATTR captureISR() {
  uint32_t now = micros();
  uint32_t d = now - isrLastT;
  isrLastT = now;
  if (isrCount < MAXP) pulses[isrCount++] = (d > 65000UL) ? 65000 : (uint16_t)d;
}

void record() {
  radioRx();
  Serial.println(F(">>> Clavier Retekess a ~3 cm. TAPE la touche du bipper"));
  Serial.println(F("    plusieurs fois (5-6x) des maintenant..."));
  int startLevel = digitalRead(CC_GDO0);
  isrCount = 0;
  isrLastT = micros();
  attachInterrupt(digitalPinToInterrupt(CC_GDO0), captureISR, CHANGE);

  // Attendre une rafale dense (>=25 fronts / 50 ms) = un vrai appui
  unsigned long t0 = millis();
  int prevCount = 0; unsigned long prevMs = millis(); bool burst = false;
  while (millis() - t0 < 12000) {
    delay(10);
    unsigned long nowMs = millis();
    if (nowMs - prevMs >= 50) {
      if (isrCount - prevCount >= 25) { burst = true; break; }
      prevCount = isrCount; prevMs = nowMs;
    }
  }
  if (!burst) {
    detachInterrupt(digitalPinToInterrupt(CC_GDO0));
    ELECHOUSE_cc1101.setSidle();
    Serial.println(F("Pas de signal franc. Rapproche, refais 'rec' et tape plusieurs fois."));
    return;
  }
  Serial.println(F("Signal ! Continue a taper encore ~4 s..."));
  unsigned long capStart = millis();
  while (millis() - capStart < 4000 && isrCount < MAXP) { delayMicroseconds(300); }
  detachInterrupt(digitalPinToInterrupt(CC_GDO0));
  ELECHOUSE_cc1101.setSidle();

  nPulses = isrCount - 1;                          // pulses[0] = partiel avant 1er front
  for (int i = 0; i < nPulses; i++) pulses[i] = pulses[i + 1];
  recLevel0 = (startLevel == HIGH) ? LOW : HIGH;
  Serial.print(F("Capture : ")); Serial.print(nPulses); Serial.println(F(" fronts."));
  Serial.println(F("-> 'play' pour rejouer."));
}

void play(int rounds) {
  if (nPulses == 0) { Serial.println(F("Rien en memoire. Fais 'rec' d'abord.")); return; }
  Serial.print(F(">>> Rejeu brut x")); Serial.println(rounds);
  radioTx();
  for (int r = 0; r < rounds; r++) {
    int level = recLevel0;
    for (int i = 0; i < nPulses; i++) {
      digitalWrite(CC_GDO0, level);
      delayMicroseconds(pulses[i]);
      level = !level;
    }
    digitalWrite(CC_GDO0, LOW);
    delayMicroseconds(GAP);
  }
  digitalWrite(CC_GDO0, LOW);
  ELECHOUSE_cc1101.setSidle();
  Serial.println(F("Rejoue. Sonne ?"));
}

// Vide le tampon capture sur le port serie (CSV entre <<< et >>>) pour
// decodage cote PC : on en extrait l'adresse de base + le numero du pager.
void dumpPulses() {
  if (nPulses == 0) { Serial.println(F("DUMP vide - fais 'rec' d'abord.")); return; }
  Serial.print(F("DUMP nPulses=")); Serial.print(nPulses);
  Serial.print(F(" level0=")); Serial.println(recLevel0);
  Serial.println(F("<<<"));
  for (int i = 0; i < nPulses; i++) {
    Serial.print((unsigned)pulses[i]);
    Serial.print(i + 1 < nPulses ? ',' : '\n');
    if ((i & 63) == 63) Serial.flush();
  }
  Serial.println(F(">>>"));
}

// Trame de reference capturee au clavier le 11 juin (1er front = HAUT).
const uint16_t TESTFRAME[] = {
  431,660,440,449,901,180,470,614,656,449,180,890,591,430,169,861,599,431,169,850,
  211,209,191,410,190,809,601,430,610,430,200,820,619,421,620,430,599,450,401,599,
  611,419,601,430,210,839,620,430,631,429,201,870,589,431,189,630,850,630,411,399,
  200,820,600,401,600,434,595,430,400,620,191,849,191,840,610,430,610,430,610,639,
  410,430,610,421,609,3121,239,3561,609,410,421,639,610,450,200,880,610,381,189,850,610,
  431,390,599,601,430,209,830,600,430,200,830,201,839,620,400,620,420,611,430,605,
  424,630,430,190,860,630,400,170,266,194,430,210,840,600,420,600,230,420,1250,210,
  420,176,814,190,170,220,390,215,835,190,850,601,429,611,419,610,1280,230,1070,180,
  850,621,1679,240,440,430,850,210
};
const int TESTFRAME_N = sizeof(TESTFRAME) / sizeof(TESTFRAME[0]);

void testframe() {
  Serial.print(F(">>> Trame de reference x20 (")); Serial.print(TESTFRAME_N);
  Serial.println(F(" fronts) - ecoute TOUS les pagers..."));
  radioTx();
  for (int r = 0; r < 20; r++) {
    int level = HIGH;
    for (int i = 0; i < TESTFRAME_N; i++) {
      digitalWrite(CC_GDO0, level);
      delayMicroseconds(TESTFRAME[i]);
      level = !level;
    }
    digitalWrite(CC_GDO0, LOW);
    delayMicroseconds(GAP);
  }
  digitalWrite(CC_GDO0, LOW);
  ELECHOUSE_cc1101.setSidle();
  Serial.println(F("Fini. Un pager a-t-il reagi ?"));
}

// ======================= WiFi + poll Schproutz ========================
//  La carte se connecte au WiFi du resto, puis interroge l'edge pager-poll
//  toutes les POLL_MS. Elle envoie son DEVICE_TOKEN ; l'edge renvoie les
//  numeros de bipper a faire sonner (et les marque "dispatches" cote serveur).
// ======================================================================
void wifiConnect() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print(F("WiFi: connexion a \"")); Serial.print(F(WIFI_SSID)); Serial.print(F("\" "));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(400); Serial.print('.');
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F(" OK  ip=")); Serial.println(WiFi.localIP());
  } else {
    Serial.println(F(" ECHEC (nouvel essai plus tard)"));
  }
}

void pollAndRing() {
  WiFiClientSecure client;
  client.setInsecure();                    // pas de validation de cert (suffisant ici)
  HTTPClient http;
  http.setTimeout(4000);
  if (!http.begin(client, POLL_URL)) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPA_ANON);
  http.addHeader("Authorization", "Bearer " SUPA_ANON);
  String reqBody = String("{\"device_token\":\"") + DEVICE_TOKEN + "\"}";
  int code = http.POST(reqBody);
  if (code == 200) {
    String resp = http.getString();
    JsonDocument doc;                      // ArduinoJson 7 : document elastique
    if (!deserializeJson(doc, resp)) {
      for (JsonVariant v : doc["numbers"].as<JsonArray>()) {
        int n = v.as<int>();
        if (n >= 1 && n <= 255) {
          Serial.print(F("[poll] -> appel bipper ")); Serial.println(n);
          ring(n);
        }
      }
    }
  } else if (code > 0) {
    static unsigned long lastErr = 0;
    if (millis() - lastErr > 30000) {      // log discret, pas de spam
      lastErr = millis();
      Serial.print(F("[poll] HTTP ")); Serial.println(code);
    }
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println(F("=== LilyGO + CC1101 - EMETTEUR T112 v1 ==="));
  // Deselectionne le SX1278 embarque pour qu'il ne parle jamais sur son bus.
  pinMode(SX_CS, OUTPUT);
  digitalWrite(SX_CS, HIGH);
  radioTx();
  diag();
  wifiConnect();
  Serial.println(F("Pret. Poll pager-poll actif. Tape un numero (ex 33), ou : t/sweep/rec/dump/play/tf/diag"));
}

void loop() {
  // 1) File d'attente Schproutz : poll periodique + reconnexion WiFi douce.
  static unsigned long lastPoll = 0, lastWifiTry = 0;
  if (WiFi.status() == WL_CONNECTED) {
    if (millis() - lastPoll > POLL_MS) { lastPoll = millis(); pollAndRing(); }
  } else if (millis() - lastWifiTry > 5000) {
    lastWifiTry = millis(); wifiConnect();
  }

  // 2) Commandes serie (test manuel depuis le Mac) — inchange.
  if (!Serial.available()) return;
  delay(30);
  String line = Serial.readStringUntil('\n');
  line.trim();
  line.toLowerCase();
  if (line.length() == 0) return;

  if (line == "diag")  { diag();       return; }
  if (line == "t")     { carrier();    return; }
  if (line == "sweep") { sweep();      return; }
  if (line == "rec")   { record();     return; }
  if (line == "play")  { play(8);      return; }
  if (line == "dump")  { dumpPulses(); return; }
  if (line == "tf" || line == "testframe") { testframe(); return; }

  int num = line.toInt();
  if (num <= 0 || num > 255) { Serial.println(F("Tape 1-255, ou t/sweep/rec/play/tf/diag")); return; }
  ring(num);
}

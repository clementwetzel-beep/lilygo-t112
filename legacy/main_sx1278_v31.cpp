#include <RadioLib.h>

// =====================================================================
//  ETAPE 3g - EMETTEUR + DIAGNOSTIC REGISTRES
//  Commandes : <numero> | sweep | t | diag
//  "diag" lit les registres de la puce pour voir si elle est vraiment
//  en mode emission continue OOK avec l'ampli PA_BOOST actif.
// =====================================================================

#define LORA_SCK  5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_CS   18
#define LORA_RST  23
#define LORA_DIO0 26
#define LORA_DIO1 33
#define LORA_DIO2 32

SX1278 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);

const char* BASE_ADDR = "0110100001111000";

#define T1_ON   850
#define T1_OFF  450
#define T0_ON   200
#define T0_OFF  1100
#define GAP     8700

void sendCode(const char* bits, bool invert, int repeats) {
  pinMode(LORA_DIO2, OUTPUT);
  digitalWrite(LORA_DIO2, invert ? HIGH : LOW);
  radio.transmitDirect();
  for (int r = 0; r < repeats; r++) {
    for (const char* p = bits; *p; p++) {
      digitalWrite(LORA_DIO2, invert ? LOW : HIGH);
      delayMicroseconds(*p == '1' ? T1_ON : T0_ON);
      digitalWrite(LORA_DIO2, invert ? HIGH : LOW);
      delayMicroseconds(*p == '1' ? T1_OFF : T0_OFF);
    }
    digitalWrite(LORA_DIO2, invert ? HIGH : LOW);
    delayMicroseconds(GAP);
  }
  digitalWrite(LORA_DIO2, invert ? HIGH : LOW);
  radio.standby();
}

void buildCode(int num, char* out) {
  strcpy(out, BASE_ADDR);
  for (int i = 0; i < 8; i++) out[16 + i] = ((num >> i) & 1) ? '1' : '0';
  out[24] = '\0';
}

void chk(const char* what, int st) {
  Serial.print(what); Serial.print(F(" -> "));
  if (st == RADIOLIB_ERR_NONE) Serial.println(F("OK"));
  else { Serial.print(F("ERREUR ")); Serial.println(st); }
}

// Lecture registre SX127x par SPI direct (getMod() est protected dans RadioLib).
// Trame : CS bas, octet d'adresse (bit7=0 => lecture), octet bidon, CS haut.
uint8_t rd(uint8_t addr) {
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_CS, LOW);
  SPI.transfer(addr & 0x7F);
  uint8_t v = SPI.transfer(0x00);
  digitalWrite(LORA_CS, HIGH);
  SPI.endTransaction();
  return v;
}

// Ecriture registre SX127x par SPI direct (bit7=1 => ecriture). SPI rapide
// (8 MHz) pour minimiser l'overhead quand on keye le PA en commutant le mode.
void wr(uint8_t addr, uint8_t val) {
  SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_CS, LOW);
  SPI.transfer(addr | 0x80);
  SPI.transfer(val);
  digitalWrite(LORA_CS, HIGH);
  SPI.endTransaction();
}

// RegOpMode (0x01) en mode FSK + bande basse (433) :
//  TX (011)   = ampli ON  => porteur PRESENT (continu, NE depend PAS de DIO2).
//  FSTX (010) = synth ON, ampli OFF => porteur ABSENT (PLL reste cale => switch rapide).
#define OPMODE_TXON  0x0B
#define OPMODE_TXOFF 0x0A

bool useRfo = false;   // false = PA_BOOST +17 (2x la puissance de RFO) ; true = RFO. 'pa'/'rfo'.

// Regle la puissance + OCP haut. DOIT etre appele en STANDBY (ces registres
// sont ignores en mode TX). RadioLib laissait l'OCP a ~60 mA => ampli etouffe.
void setupTxPower() {
  if (useRfo) radio.setOutputPower(15, true);   // RFO max (~+14/15 dBm)
  else        radio.setOutputPower(17, false);  // PA_BOOST +17 dBm propre (sans boost +20)
  wr(0x0B, 0x3B);                               // RegOcp : ~240 mA (ne bride plus l'ampli)
}

// Emission OOK obtenue en hachant un porteur FSK CONTINU via RegOpMode (TX<->FSTX).
// En FSK le porteur est present des qu'on est en TX (la data ne fait que decaler la
// frequence de +-5 kHz) => ca contourne TOTALEMENT le chemin data DIO2 (le suspect).
void sendCodeSPI(const char* bits, int repeats) {
  radio.standby();
  radio.setFrequency(433.92);
  radio.setOOK(false);             // FSK : porteur continu en TX
  setupTxPower();                  // PA + OCP EN STANDBY (avant le passage TX)
  radio.transmitDirect();
  delayMicroseconds(1500);         // laisser le PLL se caler
  // MOUCHARD : etat des registres TX (compare le 1er envoi=OK aux suivants=KO)
  Serial.print(F("  REG op=0x"));  Serial.print(rd(0x01), HEX);
  Serial.print(F(" pa=0x"));       Serial.print(rd(0x09), HEX);
  Serial.print(F(" dac=0x"));      Serial.print(rd(0x4D), HEX);
  Serial.print(F(" ocp=0x"));      Serial.print(rd(0x0B), HEX);
  Serial.print(F(" frf="));        Serial.print(rd(0x06), HEX); Serial.print(rd(0x07), HEX); Serial.println(rd(0x08), HEX);
  for (int r = 0; r < repeats; r++) {
    for (const char* p = bits; *p; p++) {
      wr(0x01, OPMODE_TXON);
      delayMicroseconds(*p == '1' ? T1_ON : T0_ON);
      wr(0x01, OPMODE_TXOFF);
      delayMicroseconds(*p == '1' ? T1_OFF : T0_OFF);
    }
    delayMicroseconds(GAP);        // creux inter-trame (on reste en FSTX = OFF)
  }
  radio.standby();
}

// Emission OOK "naturelle" par bit-bang DIO2, mais cette fois sur RFO + pleine
// puissance (OCP regle en standby). Pas de wr() pendant l'emission (juste digitalWrite)
// => pas de risque de corrompre l'etat SPI entre 2 envois.
void sendCodeOOK(const char* bits, int repeats) {
  radio.standby();
  radio.setFrequency(433.92);
  radio.setOOK(true);
  radio.setDataShapingOOK(0);
  setupTxPower();                  // RFO/PA + OCP, en standby
  pinMode(LORA_DIO2, OUTPUT);
  digitalWrite(LORA_DIO2, LOW);
  radio.transmitDirect();
  delayMicroseconds(1500);
  for (int r = 0; r < repeats; r++) {
    for (const char* p = bits; *p; p++) {
      digitalWrite(LORA_DIO2, HIGH);
      delayMicroseconds(*p == '1' ? T1_ON : T0_ON);
      digitalWrite(LORA_DIO2, LOW);
      delayMicroseconds(*p == '1' ? T1_OFF : T0_OFF);
    }
    digitalWrite(LORA_DIO2, LOW);
    delayMicroseconds(GAP);
  }
  digitalWrite(LORA_DIO2, LOW);
  radio.standby();
}

void printReg(const char* name, uint8_t addr) {
  uint8_t v = rd(addr);
  Serial.print(name); Serial.print(F(" (0x"));
  if (addr < 16) Serial.print('0');
  Serial.print(addr, HEX); Serial.print(F(") = 0x"));
  if (v < 16) Serial.print('0');
  Serial.println(v, HEX);
}

void verdict(const char* label, bool ok, const char* okMsg, const char* koMsg) {
  Serial.print(ok ? F("  [OK] ") : F("  [!!] "));
  Serial.print(label); Serial.print(F(" : "));
  Serial.println(ok ? okMsg : koMsg);
}

// Lit l'etat pendant l'emission et dit en clair ce qui va / ne va pas
void interpret() {
  uint8_t op  = rd(0x01);   // RegOpMode
  uint8_t pa  = rd(0x09);   // RegPaConfig
  uint8_t pc2 = rd(0x31);   // RegPacketConfig2

  Serial.println(F("------ VERDICT ------"));
  // 1. Famille FSK/OOK (pas LoRa) + modulation OOK
  bool fskFamily = (op & 0x80) == 0;
  bool ookMod    = ((op >> 5) & 0x03) == 0x01;
  verdict("Modulation", fskFamily && ookMod, "OOK (correct)",
          "PAS en OOK -> setOOK n'a pas pris");
  // 2. Mode TX continu (3 bits de poids faible = 011)
  bool txMode = (op & 0x07) == 0x03;
  verdict("Mode radio", txMode, "TX continu (correct)",
          "PAS en TX -> transmitDirect n'a pas bascule la puce");
  // 3. Ampli : PA_BOOST obligatoire (sinon emission sur RFO = antenne morte)
  bool paBoost = (pa & 0x80) != 0;
  verdict("Sortie PA", paBoost, "PA_BOOST (relie a l'antenne)",
          "RFO -> rien ne sort de l'antenne ! (forcer PA_BOOST)");
  // 4. Mode continu (pas paquet) : RegPacketConfig2 bit6 = 0
  bool continu = (pc2 & 0x40) == 0;
  verdict("Data mode", continu, "Continu (DIO2 module le porteur)",
          "PAQUET -> basculer DIO2 ne module rien (forcer continu)");

  Serial.println(F("---------------------"));
  if (fskFamily && ookMod && txMode && paBoost && continu)
    Serial.println(F("=> Config interne PARFAITE. Si rien ne sonne : cablage"));
  else
    Serial.println(F("   GPIO32<->DIO2, antenne, ou protocole/timing."));
}

void diag() {
  Serial.println(F("------ DIAG ------"));
  radio.standby();
  Serial.println(F("[STANDBY]"));
  printReg("RegOpMode       ", 0x01);
  printReg("RegPaConfig     ", 0x09);
  printReg("RegPaRamp       ", 0x0A);
  printReg("RegOcp          ", 0x0B);
  printReg("RegOokPeak      ", 0x14);
  printReg("RegPacketConfig2", 0x31);
  printReg("RegDioMapping1  ", 0x40);

  Serial.println(F("[transmitDirect + DIO2=HIGH]"));
  pinMode(LORA_DIO2, OUTPUT);
  digitalWrite(LORA_DIO2, HIGH);
  int st = radio.transmitDirect();
  Serial.print(F("transmitDirect() ret = ")); Serial.println(st);
  delay(5);
  printReg("RegOpMode       ", 0x01);
  printReg("RegPaConfig     ", 0x09);
  printReg("RegPacketConfig2", 0x31);
  printReg("RegDioMapping1  ", 0x40);
  interpret();   // <-- traduit les registres ci-dessus en clair
  delay(800);
  digitalWrite(LORA_DIO2, LOW);
  radio.standby();
  Serial.println(F("------ fin diag ------"));
}

// ====================== RECORD / REPLAY BRUT =========================
//  Capture la trame OOK reelle d'une pression clavier (RX sur DIO2),
//  puis la rejoue telle quelle (TX sur DIO2). Zero interpretation :
//  on reproduit le signal au microseconde pres.
// =====================================================================
#define MAXP 2000
uint16_t pulses[MAXP];
int nPulses = 0;
int recLevel0 = HIGH;  // niveau du tout premier front capture (HAUT/BAS)

// Trame isolee (1 seule, propre, extraite entre 2 creux inter-trames)
uint16_t frame[400];
int frameLen = 0;
int frameLevel0 = HIGH;
uint16_t interGap = 8700;  // creux entre 2 trames repetees (us)

// Isole UNE trame propre dans la capture : la portion entre deux gros creux
// inter-trames (carrier OFF le plus long). Robuste meme si la capture est
// "buffer plein" (appui maintenu) : on extrait une trame au milieu.
void isolateFrame() {
  frameLen = 0;
  const uint16_t GAPTHR = 5000;   // creux inter-trame : seuil ABSOLU (us)

  // 1) positions des gros creux OFF (separateurs de trames)
  int gapPos[80]; int ng = 0;
  int lvl = recLevel0;
  for (int i = 0; i < nPulses && ng < 80; i++) {
    if (lvl == LOW && pulses[i] > GAPTHR) gapPos[ng++] = i;
    lvl = !lvl;
  }
  if (ng < 3) { Serial.println(F("(pas assez de trames separees -> appuie plus longtemps)")); return; }

  // 2) longueur de trame la PLUS FREQUENTE = la vraie trame repetee
  //    (le bruit donne des longueurs aleatoires, la vraie trame revient identique)
  int bestLen = 0, bestCount = 0;
  for (int a = 0; a < ng - 1; a++) {
    int len = gapPos[a + 1] - gapPos[a] - 1;
    if (len < 16 || len > 120) continue;
    int c = 0;
    for (int b = 0; b < ng - 1; b++) {
      int l2 = gapPos[b + 1] - gapPos[b] - 1;
      if (l2 >= len - 2 && l2 <= len + 2) c++;
    }
    if (c > bestCount) { bestCount = c; bestLen = len; }
  }
  if (bestLen == 0) { Serial.println(F("(pas de trame reguliere trouvee)")); return; }

  // 3) extraire la 1ere occurrence de cette longueur
  for (int a = 0; a < ng - 1; a++) {
    int s = gapPos[a] + 1;
    int len = gapPos[a + 1] - gapPos[a] - 1;
    if (len >= bestLen - 2 && len <= bestLen + 2) {
      for (int k = 0; k < len; k++) frame[k] = pulses[s + k];
      frameLen = len;
      frameLevel0 = (s % 2 == 0) ? recLevel0 : !recLevel0;
      interGap = 8700;
      break;
    }
  }
  Serial.print(F("==> TRAME ISOLEE : ")); Serial.print(frameLen);
  Serial.print(F(" fronts, repetee ")); Serial.print(bestCount);
  Serial.println(F(" fois (= coherent, c'est la vraie trame)"));
  Serial.print(F("    (us, 1er=")); Serial.print(frameLevel0 == HIGH ? F("HAUT") : F("BAS")); Serial.print(F(") : "));
  for (int k = 0; k < frameLen; k++) { Serial.print(frame[k]); Serial.print(' '); }
  Serial.println();
  Serial.println(F("    -> 'splay' rejoue CETTE trame (sans DIO2)."));
}

// Capture par INTERRUPTION : chaque front est horodate au plus pres (pas de
// front rate ni de jitter de boucle, contrairement au polling digitalRead).
volatile uint32_t isrLastT = 0;
volatile int isrCount = 0;

void IRAM_ATTR captureISR() {
  uint32_t now = micros();
  uint32_t d = now - isrLastT;
  isrLastT = now;
  if (isrCount < MAXP) pulses[isrCount++] = (d > 65000UL) ? 65000 : (uint16_t)d;
}

void record() {
  // Config RX dediee : bande etroite + seuil PEAK a decrement LENT.
  // Le decrement lent tient le seuil haut pendant les creux => pas de chatter
  // de bruit entre les trames (l'AVERAGE, lui, chattait dans les silences).
  radio.setFrequency(433.92);
  radio.setRxBandwidth(100.0);
  radio.setBitRate(4.8);
  radio.setOOK(true);
  radio.setDataShapingOOK(0);
  radio.setOokThresholdType(RADIOLIB_SX127X_OOK_THRESH_PEAK);
  radio.setOokPeakThresholdDecrement(RADIOLIB_SX127X_OOK_PEAK_THRESH_DEC_1_8_CHIP);
  radio.receiveDirect();
  pinMode(LORA_DIO2, INPUT);
  Serial.println(F(">>> Clavier a ~3 cm. TAPE la touche du bipper PLUSIEURS FOIS"));
  Serial.println(F("    de suite (5-6 fois) des MAINTENANT (le clavier n'envoie"));
  Serial.println(F("    qu'une rafale par appui, donc on en accumule plusieurs)..."));

  int startLevel = digitalRead(LORA_DIO2);
  isrCount = 0;
  isrLastT = micros();
  attachInterrupt(digitalPinToInterrupt(LORA_DIO2), captureISR, CHANGE);

  // 1) Attendre la 1ere RAFALE DENSE (>=25 fronts en 50 ms) = un vrai appui.
  unsigned long t0 = millis();
  int prevCount = 0;
  unsigned long prevMs = millis();
  bool burst = false;
  while (millis() - t0 < 12000) {
    delay(10);
    unsigned long nowMs = millis();
    if (nowMs - prevMs >= 50) {
      if (isrCount - prevCount >= 25) { burst = true; break; }
      prevCount = isrCount;
      prevMs = nowMs;
    }
  }
  if (!burst) {
    detachInterrupt(digitalPinToInterrupt(LORA_DIO2));
    radio.standby();
    Serial.println(F("Pas de signal franc. Rapproche, retape 'rec' et TAPE plusieurs fois."));
    return;
  }
  Serial.println(F("Signal ! CONTINUE A TAPER le bipper encore quelques fois (4 s)..."));

  // 2) Fenetre FIXE de 4 s : l'utilisateur re-tape -> on accumule plein de trames.
  unsigned long capStart = millis();
  while (millis() - capStart < 4000 && isrCount < MAXP) { delayMicroseconds(300); }
  detachInterrupt(digitalPinToInterrupt(LORA_DIO2));
  radio.standby();
  bool endedSilence = (isrCount < MAXP);

  // pulses[0] = duree partielle avant le 1er front (depuis l'armement) -> jetee.
  nPulses = isrCount - 1;
  for (int i = 0; i < nPulses; i++) pulses[i] = pulses[i + 1];
  recLevel0 = (startLevel == HIGH) ? LOW : HIGH;  // niveau de pulses[0] apres le 1er front

  Serial.print(F("Capture (ISR) : ")); Serial.print(nPulses);
  Serial.print(F(" fronts, fin=")); Serial.println(endedSilence ? F("silence (OK)") : F("buffer plein"));

  // Histogramme des durees (separe HAUT/BAS) : revele les paliers du protocole.
  // 1er front capture = recLevel0, puis ca alterne.
  const uint16_t edges[] = {300, 600, 1000, 1500, 3000, 9000};
  long hiH[7] = {0}, loH[7] = {0};
  int lv = recLevel0;
  for (int i = 0; i < nPulses; i++) {
    int b = 6; for (int k = 0; k < 6; k++) if (pulses[i] < edges[k]) { b = k; break; }
    if (lv == HIGH) hiH[b]++; else loH[b]++;
    lv = !lv;
  }
  Serial.println(F("Histogramme (nb de durees par tranche us) :"));
  Serial.println(F("  tranche   : <300 <600 <1000 <1500 <3000 <9000 >=9000"));
  Serial.print  (F("  HAUT(ON)  : ")); for (int k=0;k<7;k++){Serial.print(hiH[k]);Serial.print(' ');} Serial.println();
  Serial.print  (F("  BAS (OFF) : ")); for (int k=0;k<7;k++){Serial.print(loH[k]);Serial.print(' ');} Serial.println();

  isolateFrame();   // <-- extrait UNE trame propre pour le rejeu
}

void replay(int rounds) {
  // Priorite a la trame isolee ; sinon, capture brute.
  uint16_t* buf; int n, lv0; bool isolated;
  if (frameLen > 0)      { buf = frame;  n = frameLen; lv0 = frameLevel0; isolated = true; }
  else if (nPulses > 0)  { buf = pulses; n = nPulses;  lv0 = recLevel0;   isolated = false; }
  else { Serial.println(F("Rien en memoire. Fais 'rec' d'abord.")); return; }

  Serial.print(F(">>> Rejeu x")); Serial.print(rounds);
  Serial.println(isolated ? F(" (trame isolee)") : F(" (capture brute)"));
  pinMode(LORA_DIO2, OUTPUT);
  digitalWrite(LORA_DIO2, LOW);
  radio.transmitDirect();
  for (int r = 0; r < rounds; r++) {
    int level = lv0;
    for (int i = 0; i < n; i++) {
      digitalWrite(LORA_DIO2, level);
      delayMicroseconds(buf[i]);
      level = !level;
    }
    digitalWrite(LORA_DIO2, LOW);  // creux inter-trame (porteur OFF)
    delayMicroseconds(isolated ? interGap : 8700);
  }
  digitalWrite(LORA_DIO2, LOW);
  radio.standby();
  Serial.println(F("Rejoue. Le bipper a-t-il sonne ?"));
}

// Rejeu de la trame CAPTUREE via hachage du PA (TX/FSTX), sans DIO2 :
// reproduit le porteur present/absent selon les durees captees. Zero hypothese.
void replaySPI(int rounds) {
  uint16_t* buf; int n, lv0; bool isolated;
  if (frameLen > 0)      { buf = frame;  n = frameLen; lv0 = frameLevel0; isolated = true; }
  else if (nPulses > 0)  { buf = pulses; n = nPulses;  lv0 = recLevel0;   isolated = false; }
  else { Serial.println(F("Rien en memoire. Fais 'rec' d'abord.")); return; }

  Serial.print(F(">>> Rejeu SPI/FSK x")); Serial.print(rounds);
  Serial.println(isolated ? F(" (trame isolee)") : F(" (capture brute)"));
  radio.beginFSK(433.92, 9.6, 5.0, 250.0, 17, 16, false);  // reset + re-init frais
  setupTxPower();
  radio.transmitDirect();
  delayMicroseconds(1500);
  for (int r = 0; r < rounds; r++) {
    int level = lv0;   // HAUT = porteur present
    for (int i = 0; i < n; i++) {
      wr(0x01, level == HIGH ? OPMODE_TXON : OPMODE_TXOFF);
      delayMicroseconds(buf[i]);
      level = !level;
    }
    wr(0x01, OPMODE_TXOFF);
    delayMicroseconds(isolated ? interGap : 8700);
  }
  radio.standby();
  radio.setOOK(true);              // restaure OOK pour rec
  Serial.println(F("Rejoue (SPI/FSK). Le bipper a-t-il sonne ?"));
}

// Trame de REFERENCE : une capture propre (fin=silence OK, 169 fronts,
// durees quantifiees ~210 us) prise au clavier le 11 juin. 1er front = HAUT.
// Sert a tester l'EMISSION sans dependre d'une nouvelle capture.
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
  Serial.print(F(">>> TRAME DE REFERENCE x20 (")); Serial.print(TESTFRAME_N);
  Serial.println(F(" fronts, 1er=HAUT) - ecoute TOUS les pagers..."));
  pinMode(LORA_DIO2, OUTPUT);
  digitalWrite(LORA_DIO2, LOW);
  radio.transmitDirect();
  for (int r = 0; r < 20; r++) {
    int level = HIGH;
    for (int i = 0; i < TESTFRAME_N; i++) {
      digitalWrite(LORA_DIO2, level);
      delayMicroseconds(TESTFRAME[i]);
      level = !level;
    }
    digitalWrite(LORA_DIO2, LOW);
    delayMicroseconds(8700);
  }
  digitalWrite(LORA_DIO2, LOW);
  radio.standby();
  Serial.println(F("Fini. UN pager a-t-il fait quoi que ce soit ?"));
}

void sweep() {
  char code[25];
  for (int pol = 0; pol < 2; pol++) {
    bool inv = (pol == 1);
    Serial.print(F("=== SWEEP ")); Serial.println(inv ? F("B") : F("A"));
    for (int n = 1; n <= 255; n++) {
      if (Serial.available()) { while (Serial.available()) Serial.read(); Serial.println(F("** stop **")); return; }
      buildCode(n, code);
      Serial.print(inv ? F("[B] ") : F("[A] ")); Serial.println(n);
      sendCode(code, inv, 8);
      delay(60);
    }
  }
  Serial.println(F("=== fini ==="));
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println(F("=== LilyGO T112 - EMETTEUR v31 (PA17 vs RFO) ==="));
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  chk("beginFSK",          radio.beginFSK(433.92, 9.6, 5.0, 250.0, 17, 16, true));
  chk("setOOK",            radio.setOOK(true));
  chk("setDataShapingOOK", radio.setDataShapingOOK(0));
  chk("setOutputPower",    radio.setOutputPower(17));   // (la puissance reelle est forcee par forcePower())
  radio.standby();
  Serial.println(F("Pret (PA_BOOST +17). Tape un numero (ex 135). 'rfo'/'pa' bascule."));
}

void loop() {
  if (!Serial.available()) return;
  delay(30);                       // laisser toute la ligne arriver (lecture fiable)
  String line = Serial.readStringUntil('\n');
  line.trim();
  line.toLowerCase();
  if (line.length() == 0) return;

  if (line == "diag")  { diag();  return; }
  if (line == "rec")   { record(); return; }
  if (line == "play")  { replay(8);  return; }
  if (line == "play1") { replay(1);  return; }
  if (line == "splay") { replaySPI(12); return; }
  if (line == "testframe" || line == "tf") { testframe(); return; }
  if (line == "dump") {
    if (nPulses == 0) { Serial.println(F("Rien. Fais 'rec' d'abord.")); return; }
    Serial.print(F("DUMP ")); Serial.print(nPulses);
    Serial.print(F(" fronts, 1er=")); Serial.println(recLevel0 == HIGH ? F("HAUT") : F("BAS"));
    for (int i = 0; i < nPulses; i++) { Serial.print(pulses[i]); Serial.print(' '); }
    Serial.println();
    return;
  }
  if (line == "sweep") { sweep(); return; }
  if (line == "rfo") { useRfo = true;  Serial.println(F("Sortie = RFO (forcee a l'emission).")); return; }
  if (line == "pa")  { useRfo = false; Serial.println(F("Sortie = PA_BOOST max +20 dBm (forcee).")); return; }
  // Emission par commutation TX/FSTX (independante de DIO2). Ex: "s135"
  if (line.length() > 1 && line[0] == 's') {
    int n = line.substring(1).toInt();
    if (n <= 0 || n > 255) { Serial.println(F("Ex: s135")); return; }
    char code[25];
    buildCode(n, code);
    Serial.print(F(">>> SPI-keying bipper ")); Serial.print(n);
    Serial.print(F(" ")); Serial.print(code); Serial.println(F(" x40..."));
    sendCodeSPI(code, 40);
    Serial.println(F("Fini. Le bipper a-t-il sonne ?"));
    return;
  }
  if (line == "t") {
    Serial.println(F(">>> Porteur continu 2 s..."));
    pinMode(LORA_DIO2, OUTPUT);
    radio.transmitDirect();
    digitalWrite(LORA_DIO2, HIGH);
    delay(2000);
    digitalWrite(LORA_DIO2, LOW);
    radio.standby();
    Serial.println(F("Fini."));
    return;
  }

  int num = line.toInt();
  if (num <= 0 || num > 255) { Serial.println(F("Tape un numero 1-255 (ou rec/splay/rfo/pa/diag)")); return; }
  char code[25];
  buildCode(num, code);
  Serial.print(F(">>> Bipper ")); Serial.print(num); Serial.print(F(" ")); Serial.print(code);
  Serial.println(F(" (FSK x60)..."));
  sendCodeSPI(code, 60);            // methode FSK (la seule qui a deja sonne)
  Serial.println(F("Fini. Sonne ?"));
}

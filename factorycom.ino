#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#define DHTPIN        4
#define DHTTYPE       DHT11
#define VIBRATION_PIN 14

const char* ssid      = "WIFI_NAME";
const char* password  = "WIFI_PASSWORD";
const char* serverUrl = "https://factorycom.onrender.com/api/sensors";
const char* machineId = "M-001";

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(VIBRATION_PIN, INPUT);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

void loop() {
  float temp     = dht.readTemperature();
  float humidity = dht.readHumidity();
  bool vibration = digitalRead(VIBRATION_PIN);

  Serial.printf("Temp: %.1f | Humidity: %.1f | Vibration: %d\n", temp, humidity, vibration);

  if (isnan(temp) || isnan(humidity)) {
    Serial.println("DHT read failed, skipping");
    delay(2000);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, skipping");
    delay(2000);
    return;
  }

  StaticJsonDocument<256> doc;
  doc["machineId"]   = machineId;
  doc["temperature"] = temp;
  doc["humidity"]    = humidity;
  doc["vibration"]   = vibration;
  // A running lathe always vibrates — fault only when temperature exceeds safe threshold
  doc["status"]      = (temp > 75.0) ? "fault" : "active";

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(body);
  if (httpCode > 0)
    Serial.printf("HTTP %d: %s\n", httpCode, http.getString().c_str());
  else
    Serial.printf("POST failed: %s\n", http.errorToString(httpCode).c_str());

  http.end();
  delay(2000);
}
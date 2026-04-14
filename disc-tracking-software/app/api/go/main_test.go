package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"project2/disc-tracking-software/pb"

	"google.golang.org/protobuf/proto"
)

func makeBearerToken(t *testing.T, secret string, claims map[string]any) string {
	t.Helper()

	headerJSON := `{"alg":"HS256","typ":"JWT"}`
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("failed to marshal claims: %v", err)
	}

	headerPart := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))
	payloadPart := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := headerPart + "." + payloadPart

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sigPart := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return "Bearer " + signingInput + "." + sigPart
}

func TestParseAndVerifyBearerToken(t *testing.T) {
	secret := "test-secret"
	bearer := makeBearerToken(t, secret, map[string]any{"user_id": "user-123"})

	claims, err := parseAndVerifyBearerToken(bearer, secret)
	if err != nil {
		t.Fatalf("expected token to verify, got error: %v", err)
	}

	if extractUserIDFromClaims(claims) != "user-123" {
		t.Fatalf("unexpected user id: got %q", extractUserIDFromClaims(claims))
	}
}

func TestParseAndVerifyBearerToken_BadSignature(t *testing.T) {
	secret := "test-secret"
	bearer := makeBearerToken(t, secret, map[string]any{"sub": "user-999"})
	bearer = strings.Replace(bearer, "Bearer ", "Bearer bad", 1)

	_, err := parseAndVerifyBearerToken(bearer, secret)
	if err == nil {
		t.Fatalf("expected invalid token error")
	}
}

func TestCalculateTelemetrySummary(t *testing.T) {
	lat1 := 37.7749
	lon1 := -122.4194
	alt1 := 10.0
	lat2 := 37.7754
	lon2 := -122.4189
	alt2 := 15.0

	pings := []*pb.Ping{
		{DeviceId: "disc-1", Latitude: &lat1, Longitude: &lon1, Altitude: &alt1, AccelX: 5, AccelY: 5},
		{DeviceId: "disc-1", Latitude: &lat2, Longitude: &lon2, Altitude: &alt2, AccelX: 8, AccelY: 6},
	}

	distanceFt, releaseAngle, maxRPM := calculateTelemetrySummary(pings)
	if distanceFt <= 0 {
		t.Fatalf("expected positive distance, got %f", distanceFt)
	}
	if maxRPM <= 0 {
		t.Fatalf("expected positive maxRPM, got %f", maxRPM)
	}

	if fmt.Sprintf("%.1f", releaseAngle) == "0.0" {
		t.Fatalf("expected non-zero release angle, got %f", releaseAngle)
	}
}

func TestTelemetryUpdateProtobufContract(t *testing.T) {
	input := &pb.TelemetryUpdate{
		DeviceId: "disc-42",
		Lat:      37.7749,
		Lon:      -122.4194,
		Alt:      proto.Float64(5.0),
		Rpm:      812,
		Wobble:   0.123,
	}

	payload, err := proto.Marshal(input)
	if err != nil {
		t.Fatalf("failed to marshal TelemetryUpdate: %v", err)
	}

	if len(payload) == 0 {
		t.Fatalf("expected non-empty telemetry payload")
	}

	decoded := &pb.TelemetryUpdate{}
	if err := proto.Unmarshal(payload, decoded); err != nil {
		t.Fatalf("failed to unmarshal TelemetryUpdate payload: %v", err)
	}

	if decoded.DeviceId != input.DeviceId {
		t.Fatalf("device_id mismatch: got %q want %q", decoded.DeviceId, input.DeviceId)
	}
	if decoded.Lat != input.Lat {
		t.Fatalf("lat mismatch: got %f want %f", decoded.Lat, input.Lat)
	}
	if decoded.Lon != input.Lon {
		t.Fatalf("lon mismatch: got %f want %f", decoded.Lon, input.Lon)
	}
	if decoded.Rpm != input.Rpm {
		t.Fatalf("rpm mismatch: got %f want %f", decoded.Rpm, input.Rpm)
	}
	if decoded.Wobble != input.Wobble {
		t.Fatalf("wobble mismatch: got %f want %f", decoded.Wobble, input.Wobble)
	}
}

package main

import (
	"testing"
	"time"

	"project2/disc-tracking-software/pb"
	"google.golang.org/protobuf/proto"
)

// Mock Hub for testing since DetectThrowPhases uses it
func setupTestHub() *Hub {
	return &Hub{
		broadcast: make(chan []byte, 10), // Buffered channel to prevent blocking
	}
}

func TestDetectThrowPhases(t *testing.T) {
	// Setup
	hub := setupTestHub()
	// Reset active sessions map
	activeSessions = make(map[string]*ThrowSession)

	deviceID := "device-123"

	// Test Case 1: Detect Launch
	// Trigger: RPM > 400
	pingLaunch := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    15.0, // High G
	}
	currentRPMLaunch := 500.0 // > 400

	DetectThrowPhases(pingLaunch, currentRPMLaunch, hub)

	session, exists := activeSessions[deviceID]
	if !exists {
		t.Errorf("Expected session to be created for launch, but it wasn't")
	}
	if !session.IsActive {
		t.Errorf("Expected session to be active, got inactive")
	}
	if session.MaxRPM != currentRPMLaunch {
		t.Errorf("Expected MaxRPM to be %f, got %f", currentRPMLaunch, session.MaxRPM)
	}

	// Read from channel to clear it (simulating broadcast)
	select {
	case msg := <-hub.broadcast:
		// Optional: Verify message content if needed
		_ = msg
	default:
		t.Errorf("Expected broadcast message on launch, got none")
	}

	// Test Case 2: Update Max RPM
	// RPM increases
	pingUpdate := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    5.0,
	}
	currentRPMHigher := 800.0

	DetectThrowPhases(pingUpdate, currentRPMHigher, hub)

	if session.MaxRPM != currentRPMHigher {
		t.Errorf("Expected MaxRPM to update to %f, got %f", currentRPMHigher, session.MaxRPM)
	}

	// Test Case 3: Detect Landing
	// Trigger: RPM < 100 AND Z-axis ~ 1.0 (gravity)
	// Must ensure duration > 1.5s to avoid discard

	// Fast forward time for valid throw duration
	session.StartPos.Timestamp = time.Now().Add(-2 * time.Second).UnixMilli()

	pingLand := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    1.05, // Close to 1.0
	}
	currentRPMLand := 50.0 // < 100

	DetectThrowPhases(pingLand, currentRPMLand, hub)

	// Session should be removed from activeSessions or marked inactive
	// The code deletes it from the map
	_, existsAfterLand := activeSessions[deviceID]
	if existsAfterLand {
		t.Errorf("Expected session to be removed after landing, but it still exists")
	}

	// Check if broadcast happened
	select {
	case <-hub.broadcast:
		// Good
	default:
		t.Errorf("Expected broadcast message on landing, got none")
	}
}

func TestTelemetryUpdateProtobufContract(t *testing.T) {
	input := &pb.TelemetryUpdate{
		DeviceId: "disc-42",
		Lat:      37.7749,
		Lon:      -122.4194,
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

func TestDetectThrowPhasesBroadcastPayloadIsThrowStatus(t *testing.T) {
	hub := setupTestHub()
	activeSessions = make(map[string]*ThrowSession)

	deviceID := "device-status-1"
	launchPing := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    15.0,
	}

	DetectThrowPhases(launchPing, 500.0, hub)

	select {
	case payload := <-hub.broadcast:
		msg := &pb.ThrowStatus{}
		if err := proto.Unmarshal(payload, msg); err != nil {
			t.Fatalf("expected ThrowStatus protobuf payload, unmarshal failed: %v", err)
		}
		if msg.DeviceId != deviceID {
			t.Fatalf("unexpected device id: got %q want %q", msg.DeviceId, deviceID)
		}
		if msg.Status != "IN_FLIGHT" {
			t.Fatalf("unexpected status: got %q want %q", msg.Status, "IN_FLIGHT")
		}
	default:
		t.Fatalf("expected broadcast payload but channel was empty")
	}
}

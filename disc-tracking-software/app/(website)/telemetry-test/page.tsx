import LiveTracker from '@/components/TelemetryLiveTracker';

export default function TelemetryTestPage() {
  return (
    <main className="min-h-screen bg-[#190f2A] text-white p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Telemetry Test Page</h1>
        <p className="text-white/70">
          This public page renders the live telemetry widget for browser-level integration tests.
        </p>
        <LiveTracker />
      </div>
    </main>
  );
}

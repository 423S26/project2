// components/disc-actions/ThrowResults.tsx
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useSettings } from '@/contexts/SettingsContext';
import { DistanceUnit } from './types';

// ──────────────────────────────────────────────────────────────
// ThrowResults – displays flight path chart and key metrics after a throw
// Backend integration points:
//   - Replace fake metrics (RPM, avg height) with real data
//   - Send throw data to server on auto-save or manual save
// ──────────────────────────────────────────────────────────────

type Props = {
  distance: number;          // in feet (from tracker)
  time: number;              // flight time in seconds
  unit?: DistanceUnit;
  onSaveThrow?: () => void;  // optional manual save callback
  rpm?: number;              // real RPM from gyroscope telemetry
  trajectoryData?: Array<{ distance: number; deviation: number; height?: number }>;
};

export default function ThrowResults({ distance, time, unit, onSaveThrow, rpm, trajectoryData }: Props) {
  const { settings } = useSettings();

  const convert = (val: number) => (unit === 'meters' ? val * 0.3048 : val);
  const label = unit === 'meters' ? 'm' : 'ft';

  const displayedDistance = convert(distance).toFixed(1);
  const displayedVelocity = time > 0 ? (convert(distance) / time).toFixed(1) : '0.0';
  const displayedAvgHeight = (40 * 0.65 * (unit === 'meters' ? 0.3048 : 1)).toFixed(1);

  // Use real RPM from gyroscope telemetry — no fake estimates
  const displayRpm = rpm && rpm > 0 ? Math.round(rpm) : 0;

  // Determine which metrics to show based on user settings
  const showTime = settings.selectedMetrics.includes('time');
  const showDistance = settings.selectedMetrics.includes('distance');
  const showVelocity = settings.selectedMetrics.includes('velocity');
  const showRpm = settings.selectedMetrics.includes('rpm');
  const showHeight = settings.selectedMetrics.includes('height');

  // Dynamic grid columns based on visible metrics - update deviation points with array for device data
  const visibleMetrics = [showTime, showDistance, showVelocity, showRpm, showHeight].filter(Boolean).length;
  const gridCols = visibleMetrics <= 2 ? 'grid-cols-2' : visibleMetrics <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-5';

  // Build the chart data set in the user's selected unit so axis labels,
  // tooltips and reference lines are all in one consistent scale.  When
  // we have real trajectory samples from the firmware we use them; the
  // synthetic fallback only kicks in if no samples were captured (very
  // short throws or BLE drop-outs).
  const chartData = (() => {
    if (trajectoryData && trajectoryData.length >= 2) {
      return trajectoryData.map((point, idx) => ({
        idx,
        distance: convert(point.distance),
        deviation: convert(point.deviation),
        height: convert(point.height ?? 0),
      }));
    }

    // Synthetic parabolic flight + gentle right-fade as a last-resort
    // visual when no telemetry samples were captured for this throw.
    const totalDistance = convert(distance);
    const peakHeight = totalDistance * 0.18;
    const finalDrift = totalDistance * 0.12;
    const steps = 32;
    const points: Array<{ idx: number; distance: number; deviation: number; height: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      points.push({
        idx: i,
        distance: p * totalDistance,
        // Smooth-step deviation, peaks slightly past midpoint then settles.
        deviation: finalDrift * (3 * p * p - 2 * p * p * p),
        // Parabolic altitude profile.
        height: peakHeight * 4 * p * (1 - p),
      });
    }
    return points;
  })();

  const hasRealTrajectory = (trajectoryData?.length ?? 0) >= 2;
  const totalDistance = convert(distance);

  // Symmetric deviation domain so 'center line' sits in the middle of
  // the top-down chart regardless of whether the throw drifted left or
  // right.  Pad by 20% so the line never hugs an edge.
  const maxDeviation = chartData.reduce((m, p) => Math.max(m, Math.abs(p.deviation)), 0);
  const devDomain: [number, number] = (() => {
    const span = Math.max(maxDeviation * 1.2, totalDistance * 0.1, 5);
    return [-span, span];
  })();

  const peakHeight = chartData.reduce((m, p) => Math.max(m, p.height), 0);
  const heightDomain: [number, number] = [0, Math.max(peakHeight * 1.25, totalDistance * 0.1, 5)];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white text-center">Throw Results</h3>

      {/* ── Top-down flight path (bird's eye view) ── */}
      <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-white/90">Top-Down View</h4>
          <span className="text-[10px] text-white/50">
            {hasRealTrajectory ? `${chartData.length} GPS samples` : 'estimated path'}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#456fb633" />
            <XAxis
              type="number"
              dataKey="deviation"
              domain={devDomain}
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 11 }}
              tickFormatter={(v: number) => (Math.abs(v) < 0.5 ? '0' : v.toFixed(0))}
              label={{
                value: `← left   deviation (${label})   right →`,
                position: 'insideBottom',
                offset: -10,
                fill: '#ccc',
                style: { fontSize: 12 },
              }}
            />
            <YAxis
              type="number"
              dataKey="distance"
              domain={[0, Math.max(totalDistance * 1.05, 1)]}
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 11 }}
              label={{
                value: `distance (${label})`,
                angle: -90,
                position: 'insideLeft',
                fill: '#ccc',
                offset: 10,
                style: { fontSize: 12 },
              }}
            />
            <ReferenceLine x={0} stroke="#54c4c355" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={{ background: '#223066', border: '1px solid #54c4c3', color: 'white' }}
              formatter={(value: unknown, name: unknown) => {
                const num = Number(value);
                if (Number.isNaN(num)) return ['', String(name ?? '')];
                return [
                  `${num.toFixed(1)} ${label}`,
                  name === 'distance' ? 'down-field' : String(name ?? ''),
                ];
              }}
              labelFormatter={(label2: unknown) => {
                const v = Number(label2);
                if (Number.isNaN(v)) return '';
                if (Math.abs(v) < 0.5) return 'on center line';
                return v > 0 ? `${v.toFixed(1)} ${label} right` : `${Math.abs(v).toFixed(1)} ${label} left`;
              }}
            />
            <Line
              type="monotone"
              dataKey="distance"
              stroke="#54c4c3"
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 6, fill: '#54c4c3' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Side-profile altitude (height vs distance) ── */}
      <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-white/90">Side Profile</h4>
          <span className="text-[10px] text-white/50">peak {peakHeight.toFixed(1)} {label}</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
            <defs>
              <linearGradient id="heightGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#764d9f" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#764d9f" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#456fb633" />
            <XAxis
              type="number"
              dataKey="distance"
              domain={[0, Math.max(totalDistance * 1.05, 1)]}
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 11 }}
              label={{
                value: `distance (${label})`,
                position: 'insideBottom',
                offset: -10,
                fill: '#ccc',
                style: { fontSize: 12 },
              }}
            />
            <YAxis
              type="number"
              dataKey="height"
              domain={heightDomain}
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 11 }}
              label={{
                value: `height (${label})`,
                angle: -90,
                position: 'insideLeft',
                fill: '#ccc',
                offset: 10,
                style: { fontSize: 12 },
              }}
            />
            <Tooltip
              contentStyle={{ background: '#223066', border: '1px solid #764d9f', color: 'white' }}
              formatter={(value: unknown) => {
                const num = Number(value);
                return [Number.isNaN(num) ? '' : `${num.toFixed(1)} ${label}`, 'height'];
              }}
              labelFormatter={(label2: unknown) => {
                const v = Number(label2);
                return Number.isNaN(v) ? '' : `at ${v.toFixed(1)} ${label} down-field`;
              }}
            />
            <Area
              type="monotone"
              dataKey="height"
              stroke="#c79bff"
              strokeWidth={2}
              fill="url(#heightGrad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics Grid – dynamic columns based on selected metrics */}
      <div className={`grid ${gridCols} gap-4 text-center overflow-hidden`}>
        {showTime && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3] tabular-nums">
              {time.toFixed(2)}
            </div>
            <div className="text-xs text-white/70 mt-1">Time (s)</div>
          </div>
        )}

        {showDistance && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3] tabular-nums">
              {displayedDistance}
            </div>
            <div className="text-xs text-white/70 mt-1">Distance ({label})</div>
          </div>
        )}

        {showVelocity && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3] tabular-nums">
              {displayedVelocity}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg Velocity ({label}/s)</div>
          </div>
        )}

        {showRpm && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3] tabular-nums">
              {displayRpm}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg RPM</div>
          </div>
        )}

        {showHeight && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3] tabular-nums">
              {displayedAvgHeight}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg Height ({label})</div>
          </div>
        )}
      </div>

      {/* Save button – only shown when auto-save is OFF */}
      {!settings.autoSaveThrows && onSaveThrow && (
        <div className="flex justify-center mt-6">
          <button
            onClick={onSaveThrow}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded-xl transition shadow-md focus:outline-none focus:ring-2 focus:ring-green-500/50 touch-manipulation"
          >
            Add Throw to Records
          </button>
        </div>
      )}

      {/* Feedback when auto-save is ON */}
      {settings.autoSaveThrows && (
        <p className="text-center text-sm text-green-400 mt-4">
          Throw auto-saved to records.
        </p>
      )}


    </div>
  );
}
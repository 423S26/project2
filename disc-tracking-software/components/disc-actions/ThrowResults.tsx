// components/disc-actions/ThrowResults.tsx
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useSettings, MetricKey } from '@/contexts/SettingsContext';
import { DistanceUnit } from './types';

type Props = {
  distance: number;
  time: number;
  unit?: DistanceUnit;
  onSaveThrow?: () => void;
};

type DeviationPoint = {
  progress: number;
  deviation: number;
};

export default function ThrowResults({ distance, time, unit = 'feet', onSaveThrow }: Props) {
  const { settings } = useSettings();
  const convert = (val: number) => (unit === 'meters' ? val * 0.3048 : val);
  const label = unit === 'meters' ? 'm' : 'ft';

  const displayedDistance = convert(distance).toFixed(1);
  const displayedVelocity = time > 0 ? (convert(distance) / time).toFixed(1) : '0.0';
  const displayedAvgHeight = (40 * 0.65 * (unit === 'meters' ? 0.3048 : 1)).toFixed(1);
  const fakeRpm = Math.round(350 + (distance / 400) * 250);

  // Determine which metrics to show
  const showTime = settings.selectedMetrics.includes('time');
  const showDistance = settings.selectedMetrics.includes('distance');
  const showVelocity = settings.selectedMetrics.includes('velocity');
  const showRpm = settings.selectedMetrics.includes('rpm');
  const showHeight = settings.selectedMetrics.includes('height');

  // Dynamic column count based on visible metrics
  const visibleMetrics = [showTime, showDistance, showVelocity, showRpm, showHeight].filter(Boolean).length;
  const gridCols = visibleMetrics <= 2 ? 'grid-cols-2' : visibleMetrics <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-5';

  const chartData = (() => {
    const points = [];
    const steps = 40;
    const maxHeightFt = 40;
    const maxHeight = convert(maxHeightFt);

    const deviationPoints: DeviationPoint[] = [
      { progress: 0.000, deviation: 0.00 },
      { progress: 0.032, deviation: 1.28 },
      { progress: 0.065, deviation: 2.56 },
      { progress: 0.097, deviation: 3.84 },
      { progress: 0.129, deviation: 5.12 },
      { progress: 0.161, deviation: 6.40 },
      { progress: 0.194, deviation: 7.68 },
      { progress: 0.226, deviation: 8.96 },
      { progress: 0.258, deviation: 10.00 },
      { progress: 0.290, deviation: 11.60 },
      { progress: 0.323, deviation: 13.60 },
      { progress: 0.355, deviation: 15.60 },
      { progress: 0.387, deviation: 17.60 },
      { progress: 0.419, deviation: 19.20 },
      { progress: 0.452, deviation: 20.00 },
      { progress: 0.484, deviation: 21.60 },
      { progress: 0.516, deviation: 24.00 },
      { progress: 0.548, deviation: 26.40 },
      { progress: 0.581, deviation: 28.40 },
      { progress: 0.613, deviation: 29.60 },
      { progress: 0.645, deviation: 30.00 },
      { progress: 0.677, deviation: 29.60 },
      { progress: 0.710, deviation: 28.80 },
      { progress: 0.742, deviation: 27.60 },
      { progress: 0.774, deviation: 26.40 },
      { progress: 0.806, deviation: 25.60 },
      { progress: 0.839, deviation: 25.20 },
      { progress: 0.871, deviation: 22.80 },
      { progress: 0.903, deviation: 20.40 },
      { progress: 0.935, deviation: 18.00 },
      { progress: 0.968, deviation: 16.20 },
      { progress: 1.000, deviation: 15.00 },
    ];

    const getDeviation = (progress: number) => {
      for (let j = 0; j < deviationPoints.length - 1; j++) {
        const curr = deviationPoints[j];
        const next = deviationPoints[j + 1];
        if (progress >= curr.progress && progress <= next.progress) {
          const t = (progress - curr.progress) / (next.progress - curr.progress);
          return curr.deviation + t * (next.deviation - curr.deviation);
        }
      }
      return deviationPoints[deviationPoints.length - 1].deviation;
    };

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const distanceTraveled = progress * convert(distance);
      const height = maxHeight * 4 * progress * (1 - progress);
      const deviation = getDeviation(progress);

      points.push({
        distance: distanceTraveled,
        deviation,
        height,
      });
    }
    return points;
  })();

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white text-center">Throw Results</h3>

      <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-4 shadow-lg h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#456fb6/30" />
            <XAxis
              dataKey="deviation"
              type="number"
              domain={['dataMin - 20', 'dataMax + 20']}
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 12 }}
              ticks={[-100, -50, 0, 50, 100]}
              tickFormatter={(val) => (val === 0 ? 'center' : val > 0 ? `${val}` : `${val}`)}
              label={{
                value: '<- left          center          right ->',
                position: 'insideBottom',
                offset: -10,
                fill: '#ccc',
                style: { fontSize: 13 },
              }}
            />
            <YAxis
              dataKey="distance"
              stroke="#aaa"
              tick={{ fill: '#ccc', fontSize: 12 }}
              label={{
                value: `Distance (${label})`,
                angle: -90,
                position: 'insideLeft',
                fill: '#ccc',
                offset: -5,
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#223066',
                border: '1px solid #54c4c3',
                color: 'white',
              }}
              formatter={(value: any, name?: string) => {
                if (typeof value !== 'number' || Number.isNaN(value)) return '';
                const converted = convert(value);
                if (name === 'distance') return `${converted.toFixed(1)} ${label}`;
                if (name === 'height') return `${converted.toFixed(1)} ${label}`;
                return value.toFixed(1);
              }}
              labelFormatter={(label: any) => {
                const num = Number(label);
                if (Number.isNaN(num)) return '';
                return num === 0
                  ? 'Center'
                  : num > 0
                  ? `${num.toFixed(0)} ft right`
                  : `${Math.abs(num).toFixed(0)} ft left`;
              }}
            />
            <Line type="monotone" dataKey="distance" stroke="#54c4c3" strokeWidth={4} dot={false} activeDot={{ r: 8 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics Grid – dynamic columns based on selected metrics */}
      <div className={`grid ${visibleMetrics <= 2 ? 'grid-cols-2' : visibleMetrics <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-5'} gap-4 text-center overflow-hidden`}>
        {showTime && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3]">
              {time.toFixed(2)}
            </div>
            <div className="text-xs text-white/70 mt-1">Time (s)</div>
          </div>
        )}

        {showDistance && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3]">
              {displayedDistance}
            </div>
            <div className="text-xs text-white/70 mt-1">Distance ({label})</div>
          </div>
        )}

        {showVelocity && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3]">
              {displayedVelocity}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg Velocity ({label}/s)</div>
          </div>
        )}

        {showRpm && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3]">
              {fakeRpm}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg RPM</div>
          </div>
        )}

        {showHeight && (
          <div className="bg-[#223066]/60 rounded-lg p-3 sm:p-4 border border-[#764d9f]/30">
            <div className="text-base sm:text-lg font-bold text-[#54c4c3]">
              {displayedAvgHeight}
            </div>
            <div className="text-xs text-white/70 mt-1">Avg Height ({label})</div>
          </div>
        )}
      </div>

      {/* Save button – only if auto-save is OFF */}
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

      {settings.autoSaveThrows && (
        <p className="text-center text-sm text-green-400 mt-4">
          Throw auto-saved to records.
        </p>
      )}
    </div>
  );
}
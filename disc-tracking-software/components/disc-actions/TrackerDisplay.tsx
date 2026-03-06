// components/disc-actions/TrackerDisplay.tsx
import { DistanceUnit } from './types';

type Props = {
  distance: number;       // always in feet from sync
  unit?: DistanceUnit;    // from settings
};

export default function TrackerDisplay({ distance, unit = 'feet' }: Props) {
  const displayedDistance = unit === 'meters' ? (distance * 0.3048).toFixed(1) : distance;
  const label = unit === 'meters' ? 'm' : 'ft';

  return (
    <div className="mt-10 mb-12 flex flex-col items-center">
      <div className="relative w-[75%] aspect-square max-w-45 rounded-full bg-[#764d9f] flex items-center justify-center shadow-2xl ring-2 ring-[#764d9f]/30">
        <span className="text-5xl md:text-6xl font-extrabold text-white tracking-tight">
          {displayedDistance}
        </span>
      </div>
      <p className="mt-3 text-white/90 text-base md:text-lg font-medium">
        {label}
      </p>
    </div>
  );
}
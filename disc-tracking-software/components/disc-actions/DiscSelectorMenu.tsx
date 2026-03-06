// components/disc-actions/DiscSelectorMenu.tsx

import { Disc } from './types';

type Props = {
  isOpen: boolean;
  currentDiscs: Disc[];
  selectedDisc: Disc | null;
  showDiscList: boolean;
  syncStatus: 'idle' | 'success' | 'error';
  onClose: () => void;
  onToggleDiscList: () => void;
  onSelectDisc: (disc: Disc) => void;
  onSync: () => void;
  onOpenAddPopup: () => void;
  onRemoveDisc: () => void;
};

export default function DiscSelectorMenu({
  isOpen,
  currentDiscs,
  selectedDisc,
  showDiscList,
  syncStatus,
  onClose,
  onToggleDiscList,
  onSelectDisc,
  onSync,
  onOpenAddPopup,
  onRemoveDisc,
}: Props) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />

      <div
        className="absolute left-0 right-0 mt-2 rounded-xl shadow-2xl bg-[#223066]/95 backdrop-blur-lg border border-[#764d9f]/50 ring-1 ring-black/20 focus:outline-none z-50 max-h-[70vh] overflow-y-auto"
        role="menu"
      >
        <div className="py-3 px-2">
          {/* Disc Selector (custom dropdown trigger) */}
          <div className="px-4 py-4 border-b border-[#764d9f]/30">
            <p className="text-sm text-white/70 uppercase tracking-wide mb-2 font-medium">
              Select Active Disc
            </p>

            <button
              type="button"
              className="w-full flex justify-between items-center bg-[#190f2A] text-white border border-[#456fb6]/60 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40 touch-manipulation"
              onClick={onToggleDiscList}
            >
              <span className="truncate">
                {selectedDisc ? `${selectedDisc.name} - ${selectedDisc.type}` : 'Choose a disc...'}
              </span>
              <svg
                className={`w-5 h-5 transition-transform ${showDiscList ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Disc List – drops down below the selector button */}
            {showDiscList && (
              <div className="mt-1 w-full bg-[#190f2A] border border-[#456fb6]/60 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {currentDiscs.length > 0 ? (
                  currentDiscs.map((disc) => (
                    <button
                      key={disc.id}
                      className="w-full text-left px-4 py-3 text-base text-white hover:bg-[#54c4c3]/20 focus:outline-none focus:bg-[#54c4c3]/20 touch-manipulation"
                      onClick={() => onSelectDisc(disc)}
                    >
                      {disc.name} - {disc.type}
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-white/60">No discs in bag</div>
                )}
              </div>
            )}
          </div>

          {/* Sync Tracker */}
          <button
            className={`w-full text-left px-6 py-4 text-base flex items-center gap-4 rounded-lg transition touch-manipulation ${
              selectedDisc
                ? 'text-white hover:bg-[#54c4c3]/10 hover:text-[#54c4c3]'
                : 'text-white/40 cursor-not-allowed'
            }`}
            disabled={!selectedDisc}
            onClick={onSync}
          >
            <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>

            {syncStatus === 'idle' && 'Sync Current Tracker'}
            {syncStatus === 'success' && (
              <span className="flex items-center gap-3">
                Sync Successful
                <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </span>
            )}
            {syncStatus === 'error' && (
              <span className="flex items-center gap-3">
                Sync Failed
                <svg className="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </span>
            )}
          </button>

          {/* Add New Tracker */}
          <button
            className="flex items-center gap-4 w-full text-left px-6 py-4 text-base text-white/90 hover:bg-[#54c4c3]/10 hover:text-[#54c4c3] transition rounded-lg touch-manipulation"
            onClick={onOpenAddPopup}
          >
            <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add New Tracker Disc
          </button>

          {/* Remove Disc */}
          {selectedDisc && (
            <button
              className="w-full text-left px-6 py-4 text-base text-red-300 hover:bg-red-900/20 hover:text-red-200 transition flex items-center gap-4 rounded-lg"
              onClick={onRemoveDisc}
            >
              <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove {selectedDisc.name}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
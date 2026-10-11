import React, { useEffect, useState } from 'react';
import { GameState } from '../types/game';

interface IntermissionOverlayProps {
  gameState: GameState;
  onDismiss: () => void;
}

/**
 * Full-screen intermission shown when Token Race ends.
 * Checkered flag, token standings, SKILLS LIVE announcement.
 * This is a beat, not a flash — stays up for a few seconds.
 */
export const IntermissionOverlay: React.FC<IntermissionOverlayProps> = ({
  gameState,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Auto-dismiss after 4 seconds
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  // Sort snakes by tokens (score) descending for standings
  const standings = [...gameState.snakes].sort((a, b) => b.score - a.score);

  // Show SKILLS LIVE if any snake has a skill equipped
  const showSkillsLive = gameState.snakes.some(s => s.equippedSkill);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0F380F]/85 backdrop-blur-sm font-mono">
      <div className="bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] p-6 max-w-md w-full mx-4 text-center">
        {/* Checkered flag header */}
        <div className="text-4xl mb-2">🏁</div>
        <div className="text-2xl font-black tracking-widest text-[#0F380F] mb-4">
          TOKEN RACE OVER
        </div>

        {/* Standings */}
        <div className="mb-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#0F380F] mb-2 opacity-75">
            Final Standings
          </div>
          <div className="flex flex-col gap-1.5">
            {standings.map((snake, idx) => (
              <div
                key={snake.id}
                className="flex items-center justify-between px-3 py-1.5 bg-[#8BAC0F] border-2 border-[#0F380F]"
                style={{ borderLeftWidth: '8px', borderLeftColor: snake.color }}
              >
                <span className="flex items-center gap-2 font-bold text-sm text-[#0F380F]">
                  <span className="text-lg">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`}
                  </span>
                  <span
                    className="w-3 h-3 inline-block border border-[#0F380F]"
                    style={{ backgroundColor: snake.color }}
                  />
                  <span>{snake.name}</span>
                </span>
                <span className="font-black text-lg tabular-nums text-[#0F380F]">
                  {snake.score} 💎
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Skills announcement */}
        {showSkillsLive && (
          <div className="mb-4 py-2 px-3 bg-[#0F380F] text-[#9BBC0F] font-black text-lg tracking-widest animate-pulse">
            ⚡ SKILLS LIVE ⚡
          </div>
        )}

        {/* Dismiss hint */}
        <button
          onClick={() => {
            setVisible(false);
            onDismiss();
          }}
          className="mt-2 px-4 py-1.5 bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
};

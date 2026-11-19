import { RARITIES } from '../game/constants';
import type { Item } from '../game/types';

interface RarityNameProps {
  item: Item;
  text?: string;
  className?: string;
}

export function RarityName({ item, text, className = '' }: RarityNameProps) {
  const r = RARITIES[item.rarity];
  const label = text ?? item.name;
  if (item.rarity === 4) {
    return <span className={`mythic-text ${className}`}>{label}</span>;
  }
  return (
    <span className={className} style={{ color: r.color }}>
      {label}
    </span>
  );
}

import { useEffect, useRef } from 'react';
import { getCompiledSprite } from '../game/pixelArt';
import type { SpriteKey } from '../game/types';

interface PixelSpriteIconProps {
  spriteKey: SpriteKey;
  size?: number;
  animate?: boolean;
  intervalMs?: number;
  className?: string;
  alt?: string;
}

export function PixelSpriteIcon({
  spriteKey,
  size = 32,
  animate = false,
  intervalMs = 450,
  className = '',
  alt,
}: PixelSpriteIconProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const compiled = getCompiledSprite(spriteKey);
    if (!compiled) return;

    cv.width = compiled.width;
    cv.height = compiled.height;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let frameIdx: 0 | 1 = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(compiled.frames[frameIdx], 0, 0);
    };
    draw();

    if (!animate) return;
    const id = setInterval(() => {
      frameIdx = frameIdx === 0 ? 1 : 0;
      draw();
    }, intervalMs);
    return () => clearInterval(id);
  }, [spriteKey, animate, intervalMs]);

  return (
    <canvas
      ref={canvasRef}
      width={16}
      height={16}
      aria-hidden={alt ? undefined : true}
      aria-label={alt}
      role={alt ? 'img' : undefined}
      className={`pixelated inline-block shrink-0 ${className}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
}

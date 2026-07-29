import { useEffect, useState } from 'react';

interface Props {
  name: string;
  /** Optional profile photo URL. Falls back to initials if absent or it fails to load. */
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'brand' | 'dark';
  title?: string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, src, size = 'md', variant = 'brand', title }: Props) {
  // Reset the broken-image flag whenever the source changes (e.g. after upload).
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  const cls = ['ac-avatar'];
  if (size === 'sm') cls.push('sm');
  if (size === 'lg') cls.push('lg');
  if (variant === 'dark') cls.push('dark');
  const showImg = !!src && !failed;
  if (showImg) cls.push('has-img');

  return (
    <span className={cls.join(' ')} title={title ?? name}>
      {showImg ? (
        <img
          className="ac-avatar-img"
          src={src!}
          alt={name}
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

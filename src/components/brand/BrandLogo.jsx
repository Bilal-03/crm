import React, { useId } from 'react';
import { BRAND_COLORS, PRODUCT_BRAND } from '../../../brand.js';

const SIZE_MAP = {
  sm: { mark: 'h-8 w-8', wordmark: 'text-base', tagline: 'text-[9px]' },
  md: { mark: 'h-10 w-10', wordmark: 'text-xl', tagline: 'text-[10px]' },
  lg: { mark: 'h-12 w-12', wordmark: 'text-2xl', tagline: 'text-[11px]' },
};

export function BrandLogo({
  variant = 'lockup',
  size = 'md',
  showWordmark,
  monochrome = false,
  inverse = false,
  showTagline = true,
  className = '',
}) {
  const id = useId().replaceAll(':', '');
  const sizing = SIZE_MAP[size] || SIZE_MAP.md;
  const includeWordmark = showWordmark ?? variant !== 'mark';
  const gradientId = `crm-brand-gradient-${id}`;
  const stroke = monochrome ? 'currentColor' : `url(#${gradientId})`;

  return (
    <div className={`inline-flex items-center gap-3 ${className}`} role="img" aria-label={`${PRODUCT_BRAND.name} — ${PRODUCT_BRAND.tagline}`}>
      <svg
        className={`${sizing.mark} shrink-0`}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        {!monochrome && (
          <defs>
            <linearGradient id={gradientId} x1="7" y1="38" x2="41" y2="11" gradientUnits="userSpaceOnUse">
              <stop stopColor={BRAND_COLORS.accentStrong} />
              <stop offset="1" stopColor={BRAND_COLORS.primary} />
            </linearGradient>
          </defs>
        )}
        <path d="M7 35.5 18.5 24l9 7L41 13.5" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34.5 13.5H41V20" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="35.5" r="3.5" fill={monochrome ? 'currentColor' : inverse ? '#FFFFFF' : BRAND_COLORS.ink} />
        <circle cx="18.5" cy="24" r="3.5" fill={monochrome ? 'currentColor' : BRAND_COLORS.primary} />
        <circle cx="27.5" cy="31" r="3.5" fill={monochrome ? 'currentColor' : BRAND_COLORS.accentStrong} />
        <circle cx="41" cy="13.5" r="3.5" fill={monochrome ? 'currentColor' : BRAND_COLORS.accent} />
      </svg>
      {includeWordmark && (
        <span className="min-w-0 leading-none">
          <span className={`block font-extrabold tracking-[-0.04em] ${sizing.wordmark}`}>
            <span className={monochrome ? '' : inverse ? 'text-white' : 'text-[var(--crm-ink)]'}>CRM</span>{' '}
            <span className={monochrome ? '' : inverse ? 'text-[var(--crm-accent)]' : 'text-[var(--crm-primary)]'}>Pro</span>
          </span>
          {showTagline && <span className={`mt-1 block font-semibold uppercase tracking-[0.16em] ${inverse ? 'text-white/60' : 'text-[var(--crm-muted)]'} ${sizing.tagline}`}>{PRODUCT_BRAND.tagline}</span>}
        </span>
      )}
    </div>
  );
}

export default BrandLogo;

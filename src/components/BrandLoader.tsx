/**
 * The app's loading state. `full` fills the viewport (auth bootstrap, route
 * guards); the default sits inside whatever container it is dropped into.
 *
 * The mark is the same /apex-mobile-logo.svg the collapsed sidebar uses, so
 * the first thing painted matches the chrome that replaces it.
 */
export default function BrandLoader({
  full = false,
  label = 'Loading…',
}: {
  full?: boolean;
  label?: string;
}) {
  return (
    <div
      className="ac-brand-loader d-flex flex-column justify-content-center align-items-center"
      style={{ minHeight: full ? '100vh' : '40vh' }}
      role="status"
      aria-live="polite"
    >
      <div className="ac-brand-loader-mark">
        <img src="/apex-mobile-logo.svg" alt="" width={44} height={41} />
      </div>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

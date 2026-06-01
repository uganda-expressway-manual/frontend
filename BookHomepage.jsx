/**
 * BookHomepage.jsx — Interactive book cover component.
 * Self-contained, inline-styled React component (no Tailwind needed).
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Data ────────────────────────────────────────────────────────────────────

/** Content aligned with 20260510_매뉴얼의 정의_PM.pptx (Integration Manual overview + eight volumes). */
const SECTIONS = [
  {
    title: 'Planning Manual',
    desc:
      'This volume addresses road planning, traffic demand, expressway capacity, level of service, and economic feasibility analysis for expressway programs. It establishes the analytical basis for corridor decisions and project justification.',
    bullets: [
      'Introduction and Scope',
      'Road Planning and Traffic Demand',
      'Expressway Capacity and Level of Service (LOS)',
      'Technical and Geometric Considerations',
      'Economic Feasibility Analysis',
      'Environmental and Social Considerations',
    ],
  },
  {
    title: 'Design Manual',
    desc:
      'This volume sets out design requirements for expressway projects across technical, geometric, economic, and environmental dimensions. Safety, environmental protection, and efficient vehicle operation are central to every design decision.',
    bullets: [
      'Volume 1: Geometric Design',
      'Volume 2: Earthwork & Drainage',
      'Volume 3: Pavement Design',
      'Volume 4: Bridge Design',
      'Volume 5: Tunnel Design',
      'Volume 6: Road and Auxiliary Facilities',
      'Geotechnical Investigation Guidelines',
    ],
  },
  {
    title: 'Construction Management Manual',
    desc:
      'This volume covers safety, environmental compliance, quality, cost, scheduling, and related controls for expressway construction projects. It equips construction managers with the procedures needed to deliver works effectively and in line with project objectives.',
    bullets: [
      {
        title: 'Volume 1: Manual for Major Construction Work',
        items: [
          'Execution Management of Soft Ground',
          'Execution Management of Slope Protection',
        ],
      },
      {
        title: 'Volume 2: General Provisions & Guideline for Supervision Consultant',
        items: [
          'General Provisions',
          'Guideline for Supervision Consultant',
        ],
      },
    ],
  },
  {
    title: 'Construction Specification',
    desc:
      'This volume defines construction standards for expressway civil engineering works, ancillary facilities, and comparable unit works. Its series specifications support tendering, contracting, and field execution across all major work categories.',
    bullets: [
      {
        title: 'Volume 1: Series 1000 to 5000',
        items: [
          'Series 1000: General',
          'Series 2000: Drainage & Earthworks',
          'Series 3000: Subgrade & Subbase',
          'Series 4000: Base Course',
          'Series 5000: Pavement',
        ],
      },
      {
        title: 'Volume 2: Series 6000 to 14000',
        items: [
          'Series 6000: Structures',
          'Series 7000–9000: Specialized Engineering',
          'Series 11000–12000: Road Safety and Lighting',
          'Series 13000: Landscaping and Environment',
          'Series 14000: Survey and Documentation',
        ],
      },
    ],
  },
  {
    title: 'Operation Manual',
    desc:
      'This volume addresses traffic management, incident response, facility upkeep, and customer-facing operations on expressways. Operators will find the procedures and reference material required to run the network safely and reliably.',
    bullets: [
      'General Operation',
      'Traffic Management',
      'Accident and Disaster Management',
      'Facility and Maintenance Management',
      'Customer Service and Safety',
    ],
  },
  {
    title: 'Maintenance Manual',
    desc:
      'This volume defines inspection, condition assessment, and maintenance procedures for expressway assets. Standard methods support safe, efficient upkeep of pavements, structures, drainage, tunnels, and roadside installations.',
    bullets: [
      'Volume 1: General Maintenance',
      'Volume 2: Pavement Maintenance',
      'Volume 3: Bridge Maintenance',
      'Volume 4: Road Furniture Maintenance',
      'Volume 5: Drainage & Slope Maintenance',
      'Volume 6: Tunnel Maintenance',
    ],
  },
  {
    title: 'PPP Feasibility Review Guideline',
    desc:
      'This volume advises the Government of Uganda on implementing expressway projects through Public-Private Partnerships (PPPs). It addresses legal, institutional, technical, and financial considerations together with implementation strategy.',
    bullets: [
      'Introduction and Project Background',
      'Understanding Expressway PPPs',
      'Legal and Institutional Framework Analysis',
      'Technical and Financial Feasibility Review',
      'International Benchmarking (Case Studies)',
      'Strategy for Implementation',
    ],
  },
  {
    title: 'BMS User Manual',
    desc:
      "This volume documents the Expressway Bridge Management System (BMS) used to record bridge data and inform maintenance decisions on Uganda's expressways. Integrated lifecycle data supports structural safety and more efficient maintenance planning.",
    bullets: [
      'General Overview and Access',
      'Bridge Information Management',
      'Inspection Management',
      'Bridge Condition and Analysis',
      'Statistical and Reporting Tools',
    ],
  },
];

const TOC_ENTRIES = [
  { num: '1', name: 'Expressway Planning Manual' },
  { num: '2', name: 'Expressway Design Manual' },
  { num: '3', name: 'Expressway Construction Management Manual' },
  { num: '4', name: 'Expressway Construction Specification' },
  { num: '5', name: 'Expressway Operation Manual' },
  { num: '6', name: 'Expressway Maintenance Manual' },
  { num: '7', name: 'Expressway PPP Feasibility Review Guideline' },
  { num: '8', name: 'Expressway BMS User Manual' },
];

// ─── Theme ───────────────────────────────────────────────────────────────────

const C = {
  navy: '#1a2744',
  gold: '#c97c2a',
  paper: '#faf8f3',
  paperBorder: '#d0c4aa',
  paperDot: '#d8cdb8',
  textDark: '#3a3020',
  textMid: '#6a5a40',
  textMuted: '#8a7a60',
  spineLight: '#e0d4bb',
};

const fontSerif = "'Source Serif 4', Georgia, serif";
const fontDisplay = "'Playfair Display', 'Times New Roman', serif";

/** In-book page copy (TOC, spreads, login, cover hint) — multiply legacy px sizes by this factor. */
const CONTENT_TEXT_SCALE = 1.3;
const fs = (px) => px * CONTENT_TEXT_SCALE;

/** Topic list under “Covered in this section” (chapter / volume lines and sub-items). */
const COVERED_CHAPTER_TEXT_SCALE = 1.2;
const fsc = (px) => px * COVERED_CHAPTER_TEXT_SCALE;

// ─── Timing constants ─────────────────────────────────────────────────────────

const LAST_SPREAD = SECTIONS.length + 1; // 0=toc+welcome, 1–8=manuals, 9=login
/** Open / close transitions: crossfade between one-page cover portrait and full spread — no hinge flips. */
const OPEN_MS = 560;
const CLOSE_MS = 780;
const CLOSE_HOME_MS = 780;
const FLIP_MS = 880; // in-book page turns (desktop 3‑D overlay + mobile slide)

/**
 * Design reference: spread 962×680, cover spine+face portrait 480×680 (same page height).
 * Fills viewport as much as possible while preserving ratio; subtracts ~header + gutters.
 */
const BOOK_LAYOUT_VARS = {
  '--book-page-h':
    'min(calc(100dvh - 96px), calc((100vw - 24px) * 680 / 962))',
  '--book-spread-w':
    'min(calc(100vw - 24px), calc((100dvh - 96px) * 962 / 680))',
  '--book-cover-w': 'calc(var(--book-page-h) * 480 / 680)',
};

const BOOK_PAGE_H = 'var(--book-page-h)';
const BOOK_SPREAD_W = 'var(--book-spread-w)';

/** “Covered in this section” lines that name a volume (chapter headings). */
const COVERED_VOLUME_COLOR = '#000000';
const VOLUME_CHAPTER_RE = /(Volume\s*\d+\s*:)/gi;

function hasVolumeChapter(text) {
  return Boolean(text && /volume/i.test(text));
}

function coveredBulletRowStyle(text) {
  const row = { ...styles.bulletRow, fontSize: fsc(12.5) };
  return hasVolumeChapter(text)
    ? { ...row, color: COVERED_VOLUME_COLOR }
    : row;
}

function renderCoveredSectionText(text) {
  if (!hasVolumeChapter(text)) return text;
  const parts = text.split(VOLUME_CHAPTER_RE);
  return parts.map((part, i) =>
    /^Volume\s*\d+\s*:$/i.test(part) ? (
      <strong key={`${part}-${i}`} style={{ fontWeight: 700, color: COVERED_VOLUME_COLOR }}>
        {part}
      </strong>
    ) : (
      part
    )
  );
}

// ─── Content components ───────────────────────────────────────────────────────

function TocLeftContent() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.pageHeader}>Uganda Expressway Integrated Manual</div>
      <div style={{ fontFamily: fontDisplay, fontSize: fs(22), fontWeight: 700, color: C.navy, marginBottom: 6 }}>
        Table of Contents
      </div>
      <div style={{ fontFamily: fontSerif, fontSize: fs(12), color: C.textMuted, fontStyle: 'italic', marginBottom: 24 }}>
        Integrated manuals covering the full lifecycle
      </div>
      {TOC_ENTRIES.map((e) => (
        <div key={e.num} style={styles.tocEntry}>
          <span style={{ fontFamily: fontDisplay, fontSize: fs(11), color: C.gold, fontWeight: 700, minWidth: fs(18), marginTop: 2 }}>{e.num}</span>
          <span style={{ fontFamily: fontSerif, fontSize: fs(14), color: C.navy }}>{e.name}</span>
        </div>
      ))}
    </div>
  );
}

function WelcomeRightContent() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.pageHeader}>Welcome</div>
      <div style={{ fontFamily: fontDisplay, fontSize: fs(18), fontWeight: 700, color: C.navy, marginBottom: 10, lineHeight: 1.3 }}>
        What is the Expressway Integration Manual?
      </div>
      <div style={{ width: 32, height: 1.5, background: C.gold, marginBottom: 16 }} />
      <div style={{ fontFamily: fontSerif, fontSize: fs(13.5), color: C.textDark, lineHeight: 1.75, marginBottom: 20 }}>
        The Expressway Integration Manual is a comprehensive reference for managing the full expressway lifecycle—planning,
        design, construction management, operation, and maintenance.<br /><br />
        It provides sector managers with an integrated framework for planning and overseeing expressway programs.
        The manual supports consistent, systematic delivery from initial planning through long-term maintenance.<br /><br />
        Browse the sections to explore each volume. Log in to access the full content.
      </div>
      <div style={{ padding: 14, background: 'rgba(201,124,42,0.07)', borderRadius: '0 4px 4px 0' }}>
        <div style={{ fontFamily: fontSerif, fontSize: fs(12), color: '#7a5a20', lineHeight: 1.6 }}>
          Click the <strong>right page</strong> to begin browsing →
        </div>
      </div>
    </div>
  );
}

function SectionLeftContent({ section }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.pageHeader}>{section.chapter} Uganda Expressway Integrated Manual</div>
      <div style={{ fontFamily: fontSerif, fontSize: fs(9.5), letterSpacing: '0.2em', textTransform: 'uppercase', color: C.gold, marginBottom: 8 }}>
        {section.chapter}
      </div>
      <div style={{ fontFamily: fontDisplay, fontSize: fs(26), fontWeight: 700, color: C.navy, marginBottom: 14, lineHeight: 1.2 }}>
        {section.title}
      </div>
      <div style={{ width: 32, height: 1.5, background: C.gold, marginBottom: 16 }} />
      <div style={{ fontFamily: fontSerif, fontSize: fs(14), color: C.textDark, lineHeight: 1.75 }}>
        {section.desc}
      </div>
    </div>
  );
}

function SectionRightContent({ section }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.pageHeader}>Key Topics</div>
      <div style={{ fontFamily: fontDisplay, fontSize: fs(14), fontWeight: 700, color: C.textMuted, marginBottom: 14 }}>
        Covered in this section:
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {section.bullets.map((entry) => {
          if (typeof entry === 'string') {
            return (
              <li key={entry} style={coveredBulletRowStyle(entry)}>
                <span style={{ color: C.gold, flexShrink: 0 }}>—</span>
                {renderCoveredSectionText(entry)}
              </li>
            );
          }
          return (
            <li key={entry.title}>
              <div style={coveredBulletRowStyle(entry.title)}>
                <span style={{ color: C.gold, flexShrink: 0 }}>—</span>
                {renderCoveredSectionText(entry.title)}
              </div>
              <ul style={{ listStyle: 'none', padding: '0 0 4px 18px', margin: 0 }}>
                {entry.items.map((item) => (
                  <li key={item} style={{ ...styles.bulletRow, fontSize: fsc(11.5), padding: '4px 0' }}>
                    <span style={{ color: C.textMuted, flexShrink: 0 }}>·</span>{item}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LoginLeftContent({ onLoginClick }) {
  return (
    /* height:'100%' + minHeight:0 + boxSizing ensure this container fills the
    pageInner flex column fully, so justify-content:center is computed relative
    to the full page height — not just the content height. */
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 20,
      height: '100%', minHeight: 0, boxSizing: 'border-box',
    }}>
      <div style={{ fontFamily: fontDisplay, fontSize: fs(18), fontWeight: 700, color: C.navy, marginBottom: 8 }}>Ready to dive deeper?</div>
      <div style={{ fontFamily: fontSerif, fontSize: fs(13), color: C.textMid, lineHeight: 1.6, marginBottom: 20 }}>
        You&apos;ve seen the full structure of the Uganda Expressway Integration Manual and its eight volumes.
        Log in to access the complete reference documentation, detailed specifications, and all annexes.
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onLoginClick();
        }}
        style={{
          background: C.navy, color: '#fff', fontFamily: fontSerif, fontSize: fs(13), letterSpacing: '0.08em',
          border: 'none', borderRadius: 4, padding: '10px 24px', cursor: 'pointer', pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.gold)}
        onMouseLeave={(e) => (e.currentTarget.style.background = C.navy)}
      >
        Log in to view full manual
      </button>
    </div>
  );
}

function LoginRightContent() {
  const supporters = ['KOICA', 'Korea Expressway Corporation', 'Dohwa Engineering', 'Cheil Engineering'];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.pageHeader}>Access</div>
      <div style={{ fontFamily: fontSerif, fontSize: fs(13), color: C.textMuted, fontStyle: 'italic', lineHeight: 1.6, marginBottom: 16 }}>
        This manual is available to registered users of the Uganda Ministry of Works &amp; Transport expressway management portal.
      </div>
      <div style={{ paddingTop: 14 }}>
        <div style={{ fontFamily: fontDisplay, fontSize: fs(13), color: C.navy, marginBottom: 8 }}>Supported by:</div>
        {supporters.map((s) => (
          <div key={s} style={{ fontFamily: fontSerif, fontSize: fs(12), color: C.textMid, padding: '5px 0' }}>{s}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const styles = {
  pageHeader: {
    fontFamily: fontSerif, fontSize: fs(9), letterSpacing: '0.2em', textTransform: 'uppercase',
    color: C.textMuted, paddingBottom: 10, borderBottom: `0.5px solid ${C.paperBorder}`, marginBottom: 24,
  },
  tocEntry: { display: 'flex', alignItems: 'flex-start', padding: '10px 0', gap: 14 },
  bulletRow: {
    fontFamily: fontSerif, fontSize: fs(12.5), color: '#5a4a30', padding: '6px 0',
    display: 'flex', alignItems: 'flex-start', gap: 8,
  },
  page: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    background: C.paper,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  pageTexture: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    borderRadius: 'inherit',
  },
  /* minHeight: 0 is critical — without it a flex child grows to content size,
     so justify-content:center has nothing to center within. With minHeight:0
     + flex:1 the child fills the parent's actual height and centering works
     correctly from the very first paint (no jump after animation). */
  pageInner: {
    padding: '32px 28px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    zIndex: 1,
    minHeight: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  pageFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 28px', position: 'relative', zIndex: 1 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSpreadContent(spread, side, onLoginClick) {
  if (spread === 0) return side === 'left' ? <TocLeftContent /> : <WelcomeRightContent />;
  if (spread > SECTIONS.length) return side === 'left' ? <LoginLeftContent onLoginClick={onLoginClick} /> : <LoginRightContent />;
  const section = SECTIONS[spread - 1];
  return side === 'left' ? <SectionLeftContent section={section} /> : <SectionRightContent section={section} />;
}

function getMobilePage(pageIndex, onLoginClick) {
  const spread = Math.floor(pageIndex / 2);
  const side = pageIndex % 2 === 0 ? 'left' : 'right';
  return getSpreadContent(spread, side, onLoginClick);
}

// ─── BookCover (static, closed state) ────────────────────────────────────────

function BookCover({ onClick, tiltEnabled = true }) {
  const innerRef = useRef(null);
  const hoverTimer = useRef(null);
  const [showHint, setShowHint] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const onMouseMove = useCallback((e) => {
    if (!tiltEnabled) return;
    const el = innerRef.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const dx = (e.clientX - left - width / 2) / (width / 2);
    const dy = (e.clientY - top - height / 2) / (height / 2);
    el.style.transform = `rotateY(${dx * 8}deg) rotateX(${-dy * 5}deg)`;
  }, [tiltEnabled]);

  const onMouseLeave = useCallback(() => {
    if (innerRef.current) innerRef.current.style.transform = '';
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setShowHint(false);
    setIsHovered(false);
  }, []);

  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);

  return (
    /* Outer: perspective container + click target */
    <div
      style={{ perspective: 2000, width: 'var(--book-cover-w)', height: BOOK_PAGE_H, cursor: 'pointer', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseEnter={() => {
        if (!tiltEnabled) return;
        setIsHovered(true);
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setShowHint(true), 600);
      }}
      onMouseLeave={onMouseLeave}
      role="button"
      aria-label="Open the Expressway Integrated Manual"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      {/* Inner: the book itself — this element gets the tilt transform */}
      <div
        ref={innerRef}
        style={{
          width: '100%', height: '100%',
          borderRadius: '2px 10px 10px 2px',
          boxShadow: isHovered
            ? '-10px 14px 34px rgba(0,0,0,0.44), 10px 0 14px rgba(0,0,0,0.18), 2px 0 0 #f0ebe0, 4px 0 0 #e8e2d8, 6px 0 0 #e0d9ce'
            : '-6px 6px 20px rgba(0,0,0,0.38), 4px 0 8px rgba(0,0,0,0.14), 2px 0 0 #f0ebe0, 4px 0 0 #e8e2d8, 6px 0 0 #e0d9ce',
          overflow: 'hidden',
          transition: 'box-shadow 200ms ease',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
          position: 'relative',
        }}
      >
        <img
          src="/logo/bookcover.png"
          alt="Uganda Expressway Integrated Manual cover"
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }}
        />
      </div>

      {/* "Click to open" hint */}
      <div aria-hidden style={{
        position: 'absolute', left: '50%', bottom: 18,
        transform: 'translateX(-50%)',
        fontFamily: fontSerif, fontSize: fs(12), letterSpacing: '0.06em',
        color: 'rgba(58,48,32,0.72)',
        background: 'rgba(255,255,255,0.86)',
        border: `1px solid ${C.paperBorder}`,
        borderRadius: 999, padding: '5px 11px',
        opacity: showHint ? 1 : 0, transition: 'opacity 220ms ease',
        pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        Click to open
      </div>
    </div>
  );
}

// ─── Shared spread shell (used by both animation scenes and OpenBook) ─────────

function SpreadShell({ children, style = {}, ...rest }) {
  return (
    <div
      style={{
        position: 'relative',
        width: BOOK_SPREAD_W,
        height: BOOK_PAGE_H,
        minHeight: BOOK_PAGE_H,
        maxHeight: BOOK_PAGE_H,
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: 8,
        /* NO filter here — CSS filter flattens 3-D children (breaks preserve-3d) */
        boxShadow: '0 8px 36px rgba(0,0,0,0.20)',
        /* perspective so children can do 3-D rotateY */
        perspective: 1800,
        perspectiveOrigin: '50% 50%',
        boxSizing: 'border-box',
        /*
         * overflow: visible — clipping was cutting off rotated page corners during flips,
         * which reads as unnatural. Outer scene padding + scrollbar-gutter contain layout.
         */
        overflow: 'visible',
        /* Paper behind pages so transient gaps during slide/3-D never read as “blank sheets” */
        background: C.paper,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function PageLeft({ children, onClick, cursor = 'default', style }) {
  return (
    <div
      style={{ ...styles.page, borderRadius: '8px 0 0 8px', boxShadow: 'inset -28px 0 36px rgba(0,0,0,0.13)', cursor, ...style }}
      onClick={onClick}
    >
      <div style={styles.pageTexture} />
      <div style={styles.pageInner}>{children}</div>
    </div>
  );
}

function PageRight({ children, onClick, cursor = 'default', style }) {
  return (
    <div
      style={{ ...styles.page, borderRadius: '0 8px 8px 0', boxShadow: 'inset 28px 0 36px rgba(0,0,0,0.09)', cursor, ...style }}
      onClick={onClick}
    >
      <div style={styles.pageTexture} />
      <div style={styles.pageInner}>{children}</div>
    </div>
  );
}

/* Center crease — shadow only, no visible divider line */
function Spine() {
  return (
    <div style={{
      width: 2, flexShrink: 0, background: 'transparent', zIndex: 2,
      boxShadow: '3px 0 10px rgba(0,0,0,0.13), -3px 0 10px rgba(0,0,0,0.10)',
    }} />
  );
}

// ─── BookOpeningAnimation ─────────────────────────────────────────────────────
/**
 * One portrait “page” dissolves away while the two-page spread fades and eases into place (no hinge flip).
 */
function BookOpeningAnimation({ onDone }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, OPEN_MS + 40);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: 'relative', width: '100%', display: 'flex',
      justifyContent: 'center', alignItems: 'center', minHeight: BOOK_PAGE_H,
    }}>
      <div style={{
        opacity: 0,
        animation: `openingSpreadEnter ${OPEN_MS}ms cubic-bezier(0.25, 0, 0.2, 1) forwards`,
      }}>
        <SpreadShell>
          <PageLeft><TocLeftContent /></PageLeft>
          <Spine />
          <PageRight><WelcomeRightContent /></PageRight>
        </SpreadShell>
      </div>

      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 12,
        width: 'var(--book-cover-w)', height: BOOK_PAGE_H,
        borderRadius: '2px 10px 10px 2px',
        opacity: 1,
        overflow: 'hidden',
        boxShadow: '-8px 14px 36px rgba(0,0,0,0.40), 2px 0 0 #f0ebe0, 4px 0 0 #e8e2d8',
        animation: `openingCoverDismiss ${OPEN_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`,
        pointerEvents: 'none',
      }}>
        <img src="/logo/bookcover.png" alt="" aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(to left, rgba(0,0,0,0.12) 0%, transparent 38%)'
        }} />
      </div>
    </div>
  );
}

// ─── BookClosingAnimation ─────────────────────────────────────────────────────
/**
 * Spread (two visible pages) eases away while the single portrait cover fades in — no hinge flip.
 */
function BookClosingAnimation({ spread, onDone, onLoginClick }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, CLOSE_MS + 40);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <SpreadShell style={{ animation: `closingSpreadDissolve ${CLOSE_MS}ms cubic-bezier(0.3, 0, 0.25, 1) forwards` }}>
        <PageLeft>{getSpreadContent(spread, 'left', onLoginClick)}</PageLeft>
        <Spine />
        <PageRight>{getSpreadContent(spread, 'right', onLoginClick)}</PageRight>
      </SpreadShell>

      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 25, width: 'var(--book-cover-w)', height: BOOK_PAGE_H,
        borderRadius: '2px 10px 10px 2px', overflow: 'hidden',
        boxShadow: '-6px 12px 32px rgba(0,0,0,0.40)',
        opacity: 0,
        animation: `closingCoverReveal ${CLOSE_MS}ms cubic-bezier(0.28, 0, 0.2, 1) forwards`,
      }}>
        <img src="/logo/bookcover.png" alt="" aria-hidden
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
      </div>
    </div>
  );
}

// ─── BookClosingSpreadZero (first spread → closed cover) ──────────────────────
/**
 * Same dissolve as other closes: TOC + Welcome spread fades out, portrait cover fades in (no hinge flip).
 */
function BookClosingSpreadZero({ onDone }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, CLOSE_HOME_MS + 40);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <SpreadShell style={{ animation: `closingSpreadDissolveHome ${CLOSE_HOME_MS}ms cubic-bezier(0.3, 0, 0.25, 1) forwards` }}>
        <PageLeft><TocLeftContent /></PageLeft>
        <Spine />
        <PageRight><WelcomeRightContent /></PageRight>
      </SpreadShell>

      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 25, width: 'var(--book-cover-w)', height: BOOK_PAGE_H,
        borderRadius: '2px 10px 10px 2px', overflow: 'hidden',
        boxShadow: '-6px 12px 32px rgba(0,0,0,0.40)',
        opacity: 0,
        animation: `closingCoverRevealHome ${CLOSE_HOME_MS}ms cubic-bezier(0.28, 0, 0.2, 1) forwards`,
      }}>
        <img src="/logo/bookcover.png" alt="" aria-hidden
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
      </div>
    </div>
  );
}

// ─── Mobile open/close: same dissolve style as desktop (no rotateY hinge) ──────────────────
/** @deprecated Prefer BookOpeningAnimation / BookClosing* for parity; retained if ever re-wired */
function AnimatingCover({ mode, onDone }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, mode === 'opening' ? OPEN_MS : CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [mode, onDone]);
  return (
    <div style={{ width: 'var(--book-cover-w)', height: BOOK_PAGE_H, flexShrink: 0 }}>
      <div style={{
        width: '100%', height: '100%',
        borderRadius: '2px 10px 10px 2px',
        overflow: 'hidden', position: 'relative',
        animation: mode === 'opening'
          ? `mobileCoverOpenFade ${OPEN_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`
          : `mobileCoverCloseFade ${CLOSE_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`,
        boxShadow: '-8px 14px 36px rgba(0,0,0,0.40), 2px 0 0 #f0ebe0, 4px 0 0 #e8e2d8',
      }}>
        <img src="/logo/bookcover.png" alt="" aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
      </div>
    </div>
  );
}

// ─── PageFlipOverlay (desktop in-book flip) ────────────────────────────────────
function PageFlipOverlay({ direction, fromSpread, toSpread, onLoginClick }) {
  const isForward = direction === 'forward';

  const faceBase = {
    position: 'absolute', inset: 0,
    backfaceVisibility: 'hidden',
    overflow: 'hidden',
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0, bottom: 0,
      [isForward ? 'right' : 'left']: 0,
      width: 'calc(50% - 1px)',
      zIndex: 20,
      transformOrigin: isForward ? 'left center' : 'right center',
      transformStyle: 'preserve-3d',
      animation: `${isForward ? 'pageFlipFwd' : 'pageFlipBwd'} ${FLIP_MS}ms cubic-bezier(0.38, 0, 0.24, 1) forwards`,
    }}>

      <div style={{
        ...faceBase,
        background: C.paper,
        borderRadius: isForward ? '0 8px 8px 0' : '8px 0 0 8px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={styles.pageTexture} />
        <div style={{ ...styles.pageInner, flex: 1, minHeight: 0 }}>
          {getSpreadContent(fromSpread, isForward ? 'right' : 'left', onLoginClick)}
        </div>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: isForward
            ? 'linear-gradient(to left,  rgba(0,0,0,0.20) 0%, transparent 26%)'
            : 'linear-gradient(to right, rgba(0,0,0,0.20) 0%, transparent 26%)'
        }} />
      </div>

      <div style={{
        ...faceBase,
        background: C.paper,
        transform: isForward ? 'rotateY(180deg)' : 'rotateY(-180deg)',
        borderRadius: isForward ? '8px 0 0 8px' : '0 8px 8px 0',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={styles.pageTexture} />
        <div style={{ ...styles.pageInner, flex: 1, minHeight: 0 }}>
          {getSpreadContent(toSpread, isForward ? 'left' : 'right', onLoginClick)}
        </div>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: isForward
            ? 'linear-gradient(to right, rgba(0,0,0,0.09) 0%, transparent 30%)'
            : 'linear-gradient(to left,  rgba(0,0,0,0.09) 0%, transparent 30%)'
        }} />
      </div>
    </div>
  );
}

// ─── MobileFlipOverlay ────────────────────────────────────────────────────────
function MobileFlipOverlay({ direction, fromPageIndex, onLoginClick }) {
  const isForward = direction === 'forward';
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: C.paper, overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      animation: `${isForward ? 'mobileFlipFwd' : 'mobileFlipBwd'} ${FLIP_MS}ms cubic-bezier(0.4, 0, 0.3, 1) forwards`,
    }}>
      <div style={styles.pageTexture} />
      <div style={{ ...styles.pageInner, flex: 1, minHeight: 0 }}>
        {getMobilePage(fromPageIndex, onLoginClick)}
      </div>
    </div>
  );
}

// ─── OpenBook (two-page spread) ───────────────────────────────────────────────

function OpenBook({
  spread,
  mobilePageIndex,
  isMobile,
  isFlipping,
  flipDirection,
  flipFromSpread,
  mobileFlipFromPage,
  onTurnForward,
  onTurnBackward,
  onClose,
  onLoginClick,
}) {
  const [hoverSide, setHoverSide] = useState(null);

  const canGoForward = isMobile ? mobilePageIndex < (LAST_SPREAD + 1) * 2 - 1 : spread < LAST_SPREAD;
  const canGoBackward = isMobile ? mobilePageIndex > 0 : spread > 0;
  const isFirstSpread = isMobile ? mobilePageIndex === 0 : spread === 0;

  const leftCursor = (isFirstSpread || canGoBackward) ? 'w-resize' : 'default';
  const rightCursor = canGoForward ? 'e-resize' : 'default';

  /* ── Mobile layout ── */
  if (isMobile) {
    return (
      <div style={{
        width: 'min(var(--book-spread-w), calc(100vw - 24px))',
        minHeight: BOOK_PAGE_H,
        maxHeight: BOOK_PAGE_H,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10, overflow: 'hidden',
        border: `1px solid ${C.paperBorder}`, background: C.paper,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
        position: 'relative',
      }}>
        <div style={styles.pageTexture} />
        <div style={{ ...styles.pageInner, minHeight: 0, flex: 1, pointerEvents: 'none' }}>
          {getMobilePage(mobilePageIndex, onLoginClick)}
        </div>

        {isFlipping && (
          <MobileFlipOverlay
            direction={flipDirection}
            fromPageIndex={mobileFlipFromPage}
            onLoginClick={onLoginClick}
          />
        )}

        <button type="button" onClick={() => { if (isFlipping) return; if (isFirstSpread) onClose(); else onTurnBackward(); }}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40%', opacity: 0, border: 'none', background: 'transparent', cursor: leftCursor }}
          aria-label="Previous page" />
        <button type="button" onClick={() => { if (isFlipping || !canGoForward) return; onTurnForward(); }}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40%', opacity: 0, border: 'none', background: 'transparent', cursor: rightCursor }}
          aria-label="Next page" />
      </div>
    );
  }

  /* ── Desktop layout ── */
  const leftDisplaySpread = (isFlipping && flipDirection === 'forward') ? flipFromSpread : spread;
  const rightDisplaySpread = (isFlipping && flipDirection === 'backward') ? flipFromSpread : spread;

  return (
    <SpreadShell style={{ position: 'relative' }} onMouseLeave={() => setHoverSide(null)}>
      <PageLeft cursor={leftCursor} onClick={() => { if (isFlipping) return; if (isFirstSpread) onClose(); else if (canGoBackward) onTurnBackward(); }}>
        <div onMouseEnter={() => setHoverSide('left')} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {getSpreadContent(leftDisplaySpread, 'left', onLoginClick)}
        </div>
      </PageLeft>

      <Spine />

      <PageRight cursor={rightCursor} onClick={() => { if (isFlipping || !canGoForward) return; onTurnForward(); }}>
        <div onMouseEnter={() => setHoverSide('right')} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {getSpreadContent(rightDisplaySpread, 'right', onLoginClick)}
        </div>
      </PageRight>

      {isFlipping && (
        <PageFlipOverlay
          direction={flipDirection}
          fromSpread={flipFromSpread}
          toSpread={spread}
          onLoginClick={onLoginClick}
        />
      )}

      <div aria-hidden style={{
        position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
        opacity: hoverSide === 'right' && canGoForward && !isFlipping ? 0.55 : 0,
        transition: 'opacity 180ms ease', fontSize: 26, color: 'rgba(58,48,32,0.45)',
        pointerEvents: 'none', zIndex: 11,
      }}>›</div>
      <div aria-hidden style={{
        position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)',
        opacity: hoverSide === 'left' && (canGoBackward || isFirstSpread) && !isFlipping ? 0.52 : 0,
        transition: 'opacity 180ms ease', fontSize: 24, color: 'rgba(58,48,32,0.45)',
        pointerEvents: 'none', zIndex: 11,
      }}>{isFirstSpread ? '×' : '‹'}</div>
    </SpreadShell>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

/**
 * Phase state machine:
 *  CLOSED
 *    │  click cover
 *    ▼
 *  OPENING  (BookOpeningAnimation: crossfade portrait cover → two-page spread)
 *    │  after OPEN_MS
 *    ▼
 *  OPEN
 *    │  flip through spreads (arrow keys / halves)
 *    ▼
 *  FLIPPING_FWD / FLIPPING_BWD  (page-flip animation between spreads)
 *    │  after FLIP_MS → OPEN
 *    │  click left (spread=0) → CLOSING
 *    ▼
 *  CLOSING  (BookClosing*: crossfade spread → portrait cover)
 *    │  after CLOSE_MS / CLOSE_HOME_MS
 *    ▼
 *  CLOSED
 *
 * The “Log in to view full manual” control calls the login handler directly (no page turn).
 */
export default function BookHomepage({ onLoginClick }) {
  // 'CLOSED' | 'OPENING' | 'OPEN' | 'FLIPPING_FWD' | 'FLIPPING_BWD' | 'CLOSING'
  const [phase, setPhase] = useState('CLOSED');
  const [spread, setSpread] = useState(0);
  const [flipFromSpread, setFlipFromSpread] = useState(0);
  const [mobilePageIndex, setMobilePageIndex] = useState(0);
  const [mobileFlipFrom, setMobileFlipFrom] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isTouchLike, setIsTouchLike] = useState(false);

  const handleLogin = onLoginClick ?? (() => { window.location.href = '/login'; });

  useEffect(() => {
    const sync = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
      setIsTouchLike(window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  /* ── Actions ── */

  const openBook = useCallback(() => {
    if (phase !== 'CLOSED') return;
    setSpread(0);
    setMobilePageIndex(0);
    setPhase('OPENING');
  }, [phase]);

  const handleOpenDone = useCallback(() => {
    setPhase('OPEN');
  }, []);

  const closeBook = useCallback(() => {
    if (phase !== 'OPEN') return;
    setPhase('CLOSING');
  }, [phase]);

  const handleCloseDone = useCallback(() => {
    setPhase('CLOSED');
    setSpread(0);
    setMobilePageIndex(0);
  }, []);

  const goNext = useCallback(() => {
    if (phase !== 'OPEN') return;
    if (isMobile) {
      const max = (LAST_SPREAD + 1) * 2 - 1;
      if (mobilePageIndex >= max) return;
      setMobileFlipFrom(mobilePageIndex);
      setMobilePageIndex((p) => p + 1);
      setPhase('FLIPPING_FWD');
      window.setTimeout(() => setPhase('OPEN'), FLIP_MS + 30);
    } else {
      if (spread >= LAST_SPREAD) return;
      setFlipFromSpread(spread);
      setSpread((p) => p + 1);
      setPhase('FLIPPING_FWD');
      window.setTimeout(() => setPhase('OPEN'), FLIP_MS + 30);
    }
  }, [phase, spread, mobilePageIndex, isMobile]);

  const goPrevOrClose = useCallback(() => {
    if (phase !== 'OPEN') return;
    if (isMobile) {
      if (mobilePageIndex === 0) { closeBook(); return; }
      setMobileFlipFrom(mobilePageIndex);
      setMobilePageIndex((p) => p - 1);
      setPhase('FLIPPING_BWD');
      window.setTimeout(() => setPhase('OPEN'), FLIP_MS + 30);
    } else {
      if (spread === 0) { closeBook(); return; }
      setFlipFromSpread(spread);
      setSpread((p) => p - 1);
      setPhase('FLIPPING_BWD');
      window.setTimeout(() => setPhase('OPEN'), FLIP_MS + 30);
    }
  }, [phase, spread, mobilePageIndex, isMobile, closeBook]);

  /* ── Keyboard navigation ── */
  useEffect(() => {
    const onKey = (e) => {
      if (phase !== 'OPEN') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrevOrClose(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeBook(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, goNext, goPrevOrClose, closeBook]);

  const isFlipping = phase === 'FLIPPING_FWD' || phase === 'FLIPPING_BWD';
  const flipDir = phase === 'FLIPPING_FWD' ? 'forward' : phase === 'FLIPPING_BWD' ? 'backward' : null;
  const isAnimating = phase === 'OPENING' || phase === 'CLOSING' || isFlipping;

  /* ── Body scroll lock: prevent scrollbar flash during every animation phase ── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAnimating) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
    } else {
      const savedTop = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      if (savedTop) window.scrollTo(0, parseInt(savedTop, 10) * -1);
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, [isAnimating]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap"
      />

      <main
        data-imme-manual-book
        style={{
          ...BOOK_LAYOUT_VARS,
          flex: '1 1 auto',
          minHeight: 'calc(100dvh - 72px)',
          width: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 0, background: '#f4f1ec',
          position: 'relative',
          overflowX: 'visible',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
          Uganda Expressway Integrated Manual — interactive book preview
        </h1>

        <div
          data-animating={isAnimating ? 'true' : undefined}
          style={{
            width: '100%',
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: 'clamp(8px, 1.5vh, 14px) clamp(10px, 2vw, 16px)',
            boxSizing: 'border-box',
            /* Room for spread corners — avoid clipping during open/close */
            overflow: 'visible',
            /* Disable all clicks/taps while any animation is running */
            pointerEvents: isAnimating ? 'none' : undefined,
          }}
        >

          {/* CLOSED: static cover */}
          {phase === 'CLOSED' && (
            <BookCover onClick={openBook} tiltEnabled={!isTouchLike} />
          )}

          {/* OPENING — crossfade: one-page cover → two-page spread (all viewports) */}
          {phase === 'OPENING' && (
            <BookOpeningAnimation onDone={handleOpenDone} />
          )}

          {/* OPEN / FLIPPING */}
          {(phase === 'OPEN' || isFlipping) && (
            <OpenBook
              spread={spread}
              mobilePageIndex={mobilePageIndex}
              isMobile={isMobile}
              isFlipping={isFlipping}
              flipDirection={flipDir}
              flipFromSpread={flipFromSpread}
              mobileFlipFromPage={mobileFlipFrom}
              onTurnForward={goNext}
              onTurnBackward={goPrevOrClose}
              onClose={closeBook}
              onLoginClick={handleLogin}
            />
          )}

          {/* CLOSING — crossfade: spread → portrait cover (all viewports) */}
          {phase === 'CLOSING' && (
            spread === 0
              ? <BookClosingSpreadZero onDone={handleCloseDone} />
              : <BookClosingAnimation spread={spread} onDone={handleCloseDone} onLoginClick={handleLogin} />
          )}

        </div>

      </main>

      <style>{`
        /* Reserve scrollbar width at all times so the layout never shifts when
           overflow:auto kicks in during page navigation or animation. */
        html {
          scrollbar-gutter: stable;
          overflow-y: scroll;
        }

        /* ── Open / close: no hinge flips — fade & light motion only ── */
        @keyframes openingSpreadEnter {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes openingCoverDismiss {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        /* Generic spread → cover */
        @keyframes closingSpreadDissolve {
          0% {
            opacity: 1;
          }
          52% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes closingCoverReveal {
          0%, 40% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }

        /* First spread (same timing family) */
        @keyframes closingSpreadDissolveHome {
          0% {
            opacity: 1;
          }
          52% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes closingCoverRevealHome {
          0%, 38% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }

        /* Mobile fallback if AnimatingCover is ever used */
        @keyframes mobileCoverOpenFade {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
        @keyframes mobileCoverCloseFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes pageFlipFwd {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(-180deg); }
        }
        @keyframes pageFlipBwd {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(180deg); }
        }
        @keyframes mobileFlipFwd {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(-12%); opacity: 0; }
        }
        @keyframes mobileFlipBwd {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(12%); opacity: 0; }
        }
      `}</style>
    </>
  );
}

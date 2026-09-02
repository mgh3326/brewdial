// Plain (non-TDS) replacements for the few @toss/tds-mobile* components we use,
// for the BROWSER build only. @toss/tds-mobile throws outside App-in-Toss
// ("앱인토스 개발에만 사용할 수 있어요"), so the web target aliases @toss/tds-mobile
// and @toss/tds-mobile-ait to this file (see vite.config.ts, VITE_TARGET=web).
// The .ait (Toss) build keeps the real TDS. Styled via .web-top / .web-btn in index.css.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export function TDSMobileAITProvider({ children }: { children?: ReactNode; brandPrimaryColor?: string }) {
  return <>{children}</>;
}

function TitleParagraph({ size = 22, children }: { size?: number; children?: ReactNode }) {
  return (
    <h1 className="web-top-title" style={{ fontSize: size } as CSSProperties}>
      {children}
    </h1>
  );
}
function SubtitleParagraph({ size = 15, children }: { size?: number; children?: ReactNode }) {
  return (
    <p className="web-top-sub" style={{ fontSize: size } as CSSProperties}>
      {children}
    </p>
  );
}

export function Top({ title, subtitleBottom }: { title?: ReactNode; subtitleBottom?: ReactNode }) {
  return (
    <header className="web-top">
      {title}
      {subtitleBottom}
    </header>
  );
}
Top.TitleParagraph = TitleParagraph;
Top.SubtitleParagraph = SubtitleParagraph;

export function Button({
  as,
  variant,
  href,
  children,
  onClick,
  type,
}: {
  as?: 'a' | 'button';
  variant?: string;
  href?: string;
  children?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const cls = `web-btn${variant ? ` ${variant}` : ''}`;
  if (as === 'a') {
    return (
      <a className={cls} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} type={type ?? 'button'} onClick={onClick}>
      {children}
    </button>
  );
}

type DialogButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function DialogTitle({ children }: { children?: ReactNode }) {
  return <h2 className="web-dialog-title">{children}</h2>;
}

function DialogDescription({ children }: { children?: ReactNode }) {
  return <p className="web-dialog-description">{children}</p>;
}

function DialogButton({ children, ...props }: DialogButtonProps) {
  return <button className="web-dialog-button" {...props}>{children}</button>;
}

function ConfirmDialogImpl({
  open,
  title,
  description,
  cancelButton,
  confirmButton,
  closeOnDimmerClick = true,
  onClose,
}: {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  cancelButton?: ReactNode;
  confirmButton?: ReactNode;
  closeOnDimmerClick?: boolean;
  closeOnBackEvent?: boolean;
  onClose?: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="web-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (closeOnDimmerClick && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="web-dialog" role="dialog" aria-modal="true" aria-labelledby="web-dialog-title">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="web-dialog-actions">{cancelButton}{confirmButton}</div>
      </div>
    </div>
  );
}

export const ConfirmDialog = Object.assign(ConfirmDialogImpl, {
  Title: DialogTitle,
  Description: DialogDescription,
  ConfirmButton: DialogButton,
  CancelButton: DialogButton,
});

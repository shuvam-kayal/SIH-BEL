import type { ReactNode } from "react";

export function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand"><div className="brand-mark">BEL</div><div><div className="brand-name">Bharat Electronics Limited</div><div className="brand-sub">{compact ? "Secure Enterprise Platform" : "Secure Enterprise Platform · Asset & Maintenance"}</div></div></div>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "active" | "pending" | "danger" | "neutral" | "info" }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) { return <button className={`btn ${variant}`} {...props}>{children}</button>; }
export function Card({ children, className = "", ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props}><div className="card-pad">{children}</div></section>; }
export function PageHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p className="lead">{description}</p>}</div>{action}</div>; }
export function Empty({ children = "No records found." }: { children?: ReactNode }) { return <div className="empty">{children}</div>; }
export function ErrorNotice({ message }: { message: string }) { return <div className="notice danger" role="alert">{message}</div>; }
export function Loading() { return <div className="loading"><span className="spinner" /> Loading workspace data…</div>; }
export function Stat({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) { return <div className="stat"><div className={`value ${tone}`}>{value}</div><div className="stat-label">{label}</div></div>; }
export function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
export function short(value: string, size = 18) { return value.length > size ? `${value.slice(0, Math.ceil(size / 2))}…${value.slice(-Math.floor(size / 2))}` : value; }

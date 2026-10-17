import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { Printer } from 'lucide-react';
import { guestLink } from '../config';
import { formatShortDate } from '../domain/time';
import type { IsoDate } from '../domain/types';
import { Button } from './kit';
import { AlpstayLogo } from './Logo';

export function QrCode({ text, size = 132, label }: { text: string; size?: number; label: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" className="rounded-md">
      <rect width={path.n} height={path.n} fill="#ffffff" />
      <path d={path.d} fill="#16130f" />
    </svg>
  );
}

/**
 * Cartoncino della camera (da lasciare in camera o consegnare con le chiavi): il QR apre l'area ospite
 * già riconosciuta con il numero di camera. Vale per ogni soggiorno: l'accesso dipende dalla camera attiva.
 */
export function RoomCard({ room, validUntil, publicUrl, canPrint }: { room: string; validUntil: IsoDate | null; publicUrl: string; canPrint: boolean }) {
  const link = guestLink(publicUrl, room);
  return (
    <div className="flex flex-col gap-3">
      <div className="print-card flex items-center gap-4 rounded-2xl border border-line bg-bg p-4">
        <QrCode text={link} label={`QR shuttle camera ${room}`} />
        <div className="flex min-w-0 flex-col gap-1">
          <AlpstayLogo variant="nome" title="AlpStay" className="mb-1 h-10 w-auto self-start text-fg" />
          <p className="eyebrow">Shuttle · Skishuttle</p>
          <p className="font-title text-2xl leading-none">Chalet Hartmann</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-muted">Camera · Zimmer · Room</dt>
            <dd className="tnum text-xl font-black">{room}</dd>
            {validUntil ? (
              <>
                <dt className="text-muted">Attiva fino al</dt>
                <dd className="tnum">{formatShortDate(validUntil)}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-1 text-xs leading-snug text-muted">Scansiona il QR · QR-Code scannen · Scan the QR code</p>
        </div>
      </div>
      <p className="break-all text-xs text-muted">{link}</p>
      {canPrint ? (
        <Button size="sm" onClick={() => window.print()} className="self-start">
          <Printer size={16} /> Stampa cartoncino
        </Button>
      ) : null}
    </div>
  );
}

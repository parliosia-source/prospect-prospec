import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

export default function SentMessageCard({ message: m }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const body = m.editedBody || m.generatedBody || m.body || "";
  const subject = m.editedSubject || m.generatedSubject || m.subject || "";
  const isLong = body.length > 300;

  const handleCopy = async () => {
    const text = (m.channel === "EMAIL" && subject ? `Sujet: ${subject}\n\n` : "") + body;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border rounded-xl bg-green-50 border-green-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-green-100/60 border-b border-green-200">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.channel === "LINKEDIN" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
            {m.channel}
          </span>
          <span className="text-xs text-green-700 font-medium">✓ Envoyé</span>
        </div>
        <span className="text-xs text-slate-400">
          {m.sentAt ? format(new Date(m.sentAt), "d MMM yyyy à HH:mm", { locale: fr }) : ""}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {subject && (
          <div className="text-xs font-semibold text-slate-600 mb-1.5">Sujet: {subject}</div>
        )}
        <div className={`text-sm text-slate-700 whitespace-pre-wrap leading-relaxed ${!expanded && isLong ? "line-clamp-4" : ""}`}>
          {body}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-green-200">
        {isLong ? (
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Réduire</> : <><ChevronDown className="w-3.5 h-3.5" /> Voir tout</>}
          </button>
        ) : <span />}

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-green-100 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copié !" : "Copier"}
        </button>
      </div>
    </div>
  );
}
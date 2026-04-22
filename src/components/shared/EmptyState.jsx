import { Button } from "@/components/ui/button";

export default function EmptyState({ icon: Icon, title, description, action, actionLabel }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      {Icon && (
        <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-slate-400" />
        </div>
      )}
      <h3 className="font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 max-w-xs mb-4">{description}</p>}
      {action && actionLabel && (
        <Button onClick={action} className="bg-blue-600 hover:bg-blue-700">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
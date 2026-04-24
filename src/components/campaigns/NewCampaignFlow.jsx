import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ProspectSourcePicker from "./ProspectSourcePicker";
import CampaignModal from "./CampaignModal";

/**
 * NewCampaignFlow — orchestrates two steps:
 * 1. Choose a prospect source (this dialog)
 * 2. Configure campaign details (existing CampaignModal)
 *
 * Props mirror CampaignModal: open, onClose, onSave
 * onSave receives (formData, launch) where formData includes prospectSource
 */
export default function NewCampaignFlow({ open, onClose, onSave }) {
  const [step, setStep] = useState("source"); // "source" | "config"
  const [prospectSource, setProspectSource] = useState("WEB_ENRICHED");

  const handleClose = () => {
    setStep("source");
    setProspectSource("WEB_ENRICHED");
    onClose();
  };

  const handleSourceNext = () => {
    setStep("config");
  };

  const handleSave = async (formData, launch) => {
    await onSave({ ...formData, prospectSource, kbOnlyMode: prospectSource === "KB_ONLY" }, launch);
    setStep("source");
    setProspectSource("WEB_ENRICHED");
  };

  // Step 2: delegate entirely to existing CampaignModal
  if (step === "config") {
    return (
      <CampaignModal
        open={open}
        onClose={handleClose}
        onSave={handleSave}
        prospectSource={prospectSource}
        onBack={() => setStep("source")}
      />
    );
  }

  // Step 1: source picker dialog
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle campagne — Étape 1 / 2</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <ProspectSourcePicker value={prospectSource} onChange={setProspectSource} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Annuler</Button>
          <Button onClick={handleSourceNext} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
            Suivant — Configurer →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
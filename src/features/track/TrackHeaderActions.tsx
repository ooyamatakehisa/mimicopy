import { ArrowLeft } from "lucide-react";
import { IconButton } from "../../components/ui/Button";

export function TrackHeaderActions({ onBack }: { onBack: () => void }) {
  return (
    <IconButton
      aria-label="ライブラリへ戻る"
      title="ライブラリへ戻る"
      onClick={onBack}
    >
      <ArrowLeft size={18} />
    </IconButton>
  );
}

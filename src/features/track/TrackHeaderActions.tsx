import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/Button";

export function TrackHeaderActions({ onBack }: { onBack: () => void }) {
  return (
    <Button title="ライブラリへ戻る" onClick={onBack}>
      <ArrowLeft size={18} />
      <span>Library</span>
    </Button>
  );
}

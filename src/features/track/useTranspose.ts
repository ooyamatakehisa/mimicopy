import { useCallback, useMemo, useState } from "react";
import {
  defaultTransposeSemitones,
  stepTransposeSemitones,
  type TransposeDirection
} from "../../lib/transpose";

export function useTranspose() {
  const [semitones, setSemitones] = useState(defaultTransposeSemitones);
  const changeTranspose = useCallback((direction: TransposeDirection) => {
    setSemitones((currentSemitones) =>
      stepTransposeSemitones(currentSemitones, direction)
    );
  }, []);
  const resetTranspose = useCallback(() => {
    setSemitones(defaultTransposeSemitones);
  }, []);

  return useMemo(
    () => ({
      changeTranspose,
      resetTranspose,
      semitones
    }),
    [changeTranspose, resetTranspose, semitones]
  );
}

export type TransposeState = ReturnType<typeof useTranspose>;

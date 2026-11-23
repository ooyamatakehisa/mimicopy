import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  defaultTransposeSemitones,
  stepTransposeSemitones,
  type TransposeDirection
} from "../../lib/transpose";

export function useTranspose(semitones: number, setSemitones: Dispatch<SetStateAction<number>>) {
  const changeTranspose = useCallback((direction: TransposeDirection) => {
    setSemitones((currentSemitones) =>
      stepTransposeSemitones(currentSemitones, direction)
    );
  }, [setSemitones]);
  const resetTranspose = useCallback(() => {
    setSemitones(defaultTransposeSemitones);
  }, [setSemitones]);

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

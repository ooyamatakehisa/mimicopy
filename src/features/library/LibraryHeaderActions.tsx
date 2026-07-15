import { Link, LoaderCircle, Plus, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useRef, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import type { LibraryState } from "./useLibraryState";

type LibraryHeaderActionsProps = Pick<
  LibraryState,
  "convertYoutube" | "isConverting" | "isUploading" | "uploadFile"
>;

export function LibraryHeaderActions({
  convertYoutube,
  isConverting,
  isUploading,
  uploadFile
}: LibraryHeaderActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const input = event.currentTarget;

      if (!file) {
        return;
      }

      void uploadFile(file).finally(() => {
        input.value = "";
      });
    },
    [uploadFile]
  );

  const handleYoutubeSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      void convertYoutube(youtubeUrl).then((didConvert) => {
        if (didConvert) {
          setYoutubeUrl("");
        }
      });
    },
    [convertYoutube, youtubeUrl]
  );

  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-3 max-lg:w-full max-lg:flex-col max-lg:items-stretch">
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="audio/mpeg,.mp3"
        onChange={handleFileChange}
      />
      <Button
        title="MP3を選択"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <LoaderCircle className="animate-spin" size={18} />
        ) : (
          <Upload size={18} />
        )}
        <span>{isUploading ? "保存中" : "MP3"}</span>
      </Button>

      <form
        className="grid h-11 min-w-[300px] max-w-[680px] flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] py-0 pl-4 pr-1 transition-[background,border-color,box-shadow] focus-within:border-teal/55 focus-within:bg-white/[0.09] focus-within:shadow-[0_0_0_4px_rgba(67,224,202,0.1)] max-lg:w-full max-lg:min-w-0"
        onSubmit={handleYoutubeSubmit}
      >
        <label className="sr-only" htmlFor="youtube-url">
          YouTube URL
        </label>
        <Link className="text-muted" size={18} aria-hidden="true" />
        <input
          id="youtube-url"
          className="min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-quiet"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={youtubeUrl}
          onChange={(event) => setYoutubeUrl(event.target.value)}
        />
        <IconButton type="submit" title="YouTubeを変換" disabled={isConverting}>
          {isConverting ? (
            <LoaderCircle className="animate-spin" size={18} />
          ) : (
            <Plus size={18} />
          )}
        </IconButton>
      </form>
    </div>
  );
}

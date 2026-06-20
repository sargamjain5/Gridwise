import { Upload, FileCheck, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useRef, useState } from 'react';

interface FileUploadProps {
  onFileLoaded: (text: string) => void;
  isProcessing: boolean;
  recordCount: number;
}

export function FileUpload({ onFileLoaded, isProcessing, recordCount }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) onFileLoaded(text);
    };
    reader.readAsText(file);
  };

  return (
    <Card
      className={`border-2 border-dashed cursor-pointer transition-colors ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <CardContent className="p-6 flex items-center gap-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {isProcessing ? (
          <>
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div>
              <p className="font-semibold">Processing data...</p>
              <p className="text-sm text-muted-foreground">Parsing CSV and computing metrics</p>
            </div>
          </>
        ) : recordCount > 0 ? (
          <>
            <FileCheck className="h-8 w-8 text-green-600" />
            <div>
              <p className="font-semibold text-green-700">{recordCount.toLocaleString('en-IN')} records loaded</p>
              <p className="text-sm text-muted-foreground">Drop another CSV to append or replace data</p>
            </div>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-semibold">Upload violation data (CSV)</p>
              <p className="text-sm text-muted-foreground">Drag & drop or click to browse</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

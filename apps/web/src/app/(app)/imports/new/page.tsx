'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api/client';
import type { JobSummary } from '@/lib/api/types';
import { cn, formatBytes } from '@/lib/utils';

export default function NewImportPage(): JSX.Element {
  const t = useTranslations('imports.newPage');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setFiles((prev) => [...prev, ...Array.from(incoming)]);
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const removeAt = (idx: number): void => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadMutation = useMutation({
    mutationFn: async (toUpload: File[]) => {
      const jobs: JobSummary[] = [];
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append('file', file);
        const job = await api.post<JobSummary>('/imports', fd);
        jobs.push(job);
      }
      return jobs;
    },
    onSuccess: (jobs) => {
      toast.success(`${jobs.length} import(s) queued`);
      const first = jobs[0];
      if (first) router.push(`/imports/${first.id}`);
      else router.push('/imports');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed');
    },
  });

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('description')} />
      <div className="px-8 py-6 space-y-5">
        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-16 transition-colors',
            dragOver && 'border-primary bg-primary/5',
          )}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{t('drop')}</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onChange}
            data-testid="file-input"
          />
        </Card>

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{t('files')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('fileCount', { count: files.length })} ·{' '}
                {t('totalSize', { size: formatBytes(totalSize) })}
              </p>
            </div>
            <ul className="divide-y rounded-md border">
              {files.map((file, idx) => (
                <li
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)} · {file.type || 'unknown'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAt(idx);
                    }}
                    aria-label="Remove"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              size="lg"
              disabled={files.length === 0 || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate(files)}
            >
              {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploadMutation.isPending ? t('submitting') : t('submit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

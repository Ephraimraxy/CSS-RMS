import React, { useState, useRef, useCallback, useEffect } from 'react';
import DOMPurify from 'dompurify';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Link from '@tiptap/extension-link';
import { Table as TiptapTable, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { FindReplace } from '../../lib/tiptapFindReplace';
import { templates } from '../../lib/templates';
import { toast } from 'react-hot-toast';
import VoiceDictation from '../VoiceDictation';
import ConfirmModal from '../ConfirmModal';
import { useAIFeatures } from '../../context/AIFeaturesContext';
import { ExportMenu, ExportConfirmModal, SaveIndicator, ToolbarGroup, resolveDeptCode } from './shared';
import {
  FileText, Table, File, Send, X, Scissors, Copy, Clipboard, Eraser, Search, Image as ImageIcon,
} from 'lucide-react';
import ImagePickerDropdown from '../ImagePickerDropdown';

// Word opens HTML wrapped with these MS Office namespaces natively when given a .doc extension —
// this preserves full rich-text formatting without needing a heavyweight OOXML-generation library.
const buildWordDoc = (title, contentHtml) => {
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Calibri,Arial,sans-serif;}</style>
</head><body>${contentHtml}</body></html>`;
  return new Blob(['﻿', html], { type: 'application/msword' });
};

const FONT_FAMILIES = [
  { label: 'Standard (Inter)', value: "'Inter', sans-serif" },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
  { label: 'Montserrat', value: "'Montserrat', sans-serif" },
  { label: 'Roboto', value: "'Roboto', sans-serif" },
  { label: 'Lora', value: "'Lora', serif" },
  { label: 'Courier Mono', value: "'Courier Prime', monospace" },
];

const FONT_SIZES = ['8', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36'];

const HEADING_STYLES = [
  { label: 'Normal', value: 'paragraph' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Quote', value: 'blockquote' },
];

const TOOLBAR_BTN = "p-1.5 hover:bg-muted rounded w-8 h-8 flex items-center justify-center transition-colors";
const TOOLBAR_BTN_ACTIVE = "bg-primary/15 text-primary";

const RichTextEditor = ({ loadedDraft, onAutosave, onSend, currentUser, departments }) => {
  const [title, setTitle] = useState(loadedDraft?.title || 'Untitled Document');
  const [saving, setSaving] = useState(false);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const [imgPickerVal, setImgPickerVal] = useState('');
  const autoSaveTimerRef = useRef(null);
  const titleTimerRef = useRef(null);
  const { aiEnabled } = useAIFeatures();

  useEffect(() => {
    const id = 'doc-studio-fonts';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@400;700&family=Roboto:wght@400;700&family=Lora:ital,wght@0,400;0,700;1,400&family=Courier+Prime&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const scheduleAutosave = useCallback((html) => {
    setSaving(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      onAutosave({ title, data: html });
      setSaving(false);
    }, 1500);
  }, [onAutosave, title]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Subscript,
      Superscript,
      Link.configure({ openOnClick: false }),
      TiptapTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      FontFamily,
      FontSize,
      Image,
      FindReplace,
    ],
    content: DOMPurify.sanitize(loadedDraft?.data || ''),
    editorProps: { attributes: { class: 'editor-paper' } },
    onUpdate: ({ editor }) => scheduleAutosave(editor.getHTML()),
  });

  useEffect(() => () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
  }, []);

  // Keep editor content in sync if the loaded draft changes underneath us without a
  // full remount (the parent only remounts via `key` on draft switch, not on every
  // autosave-triggered re-render) — skip the call entirely when content already matches
  // to avoid clobbering cursor position on every keystroke's own autosave round-trip.
  useEffect(() => {
    if (!editor) return;
    const clean = DOMPurify.sanitize(loadedDraft?.data || '');
    if (editor.getHTML() !== clean) editor.commands.setContent(clean, { emitUpdate: false });
    setTitle(loadedDraft?.title || 'Untitled Document');
  }, [loadedDraft, editor]);

  useEffect(() => {
    if (!editor) return;
    setSaving(true);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      onAutosave({ title, data: editor.getHTML() });
      setSaving(false);
    }, 1500);
  }, [title]);

  const activeStates = useEditorState({
    editor,
    selector: ({ editor }) => !editor ? {} : {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      subscript: editor.isActive('subscript'),
      superscript: editor.isActive('superscript'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      alignLeft: editor.isActive({ textAlign: 'left' }) || (!editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }) && !editor.isActive({ textAlign: 'justify' })),
      alignCenter: editor.isActive({ textAlign: 'center' }),
      alignRight: editor.isActive({ textAlign: 'right' }),
      alignJustify: editor.isActive({ textAlign: 'justify' }),
      link: editor.isActive('link'),
      canSinkList: editor.can().sinkListItem('listItem'),
      canLiftList: editor.can().liftListItem('listItem'),
      blockType: editor.isActive('heading', { level: 1 }) ? 'h1'
        : editor.isActive('heading', { level: 2 }) ? 'h2'
        : editor.isActive('heading', { level: 3 }) ? 'h3'
        : editor.isActive('blockquote') ? 'blockquote'
        : 'paragraph',
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    },
  });

  const [exportType, setExportType] = useState(null);
  const [exporting, setExporting] = useState(false);

  const buildExportHtml = useCallback(() => {
    const contentHtml = editor?.getHTML() || '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Calibri,Arial,sans-serif;padding:20px;">${contentHtml}</body></html>`;
  }, [title, editor]);

  const handleConfirmExport = useCallback(async () => {
    if (!exportType || !editor) return;
    setExporting(true);
    try {
      if (exportType === 'html') {
        const blob = new Blob([buildExportHtml()], { type: 'text/html' });
        saveAs(blob, `${title}.html`);
      } else if (exportType === 'docx') {
        const blob = buildWordDoc(title, editor.getHTML());
        saveAs(blob, `${title}.doc`);
      } else if (exportType === 'pdf') {
        const canvas = await html2canvas(editor.view.dom, { scale: 2, backgroundColor: '#ffffff' });
        const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const imgHeight = (canvas.height * pageWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, imgHeight);
        pdf.save(`${title}.pdf`);
      }
      toast.success('Document exported and saved locally.');
      setExportType(null);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [exportType, title, buildExportHtml, editor]);

  const insertLink = () => {
    if (!editor) return;
    const url = window.prompt('Enter URL:');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertTable = () => {
    if (!editor) return;
    const rows = parseInt(window.prompt('Number of rows:', '3'), 10) || 3;
    const cols = parseInt(window.prompt('Number of columns:', '3'), 10) || 3;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  };

  const setBlockType = (value) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (value === 'paragraph') chain.setParagraph().run();
    else if (value === 'h1') chain.toggleHeading({ level: 1 }).run();
    else if (value === 'h2') chain.toggleHeading({ level: 2 }).run();
    else if (value === 'h3') chain.toggleHeading({ level: 3 }).run();
    else if (value === 'blockquote') chain.toggleBlockquote().run();
  };

  const [findOpen, setFindOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState(false);
  const [findTerm, setFindTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const matchCount = editor?.storage?.findReplace?.matches?.length || 0;
  const activeMatchIndex = editor?.storage?.findReplace?.activeIndex || 0;

  const runSearch = (term) => {
    setFindTerm(term);
    editor?.commands.setSearchTerm(term);
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindReplaceMode(false);
    setFindTerm('');
    setReplaceTerm('');
    editor?.commands.clearSearch();
  };

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const renderTemplateHtml = (key) => {
    const tpl = templates[key];
    if (!tpl) return '';
    const deptInfo = (departments || []).find(d => d.id === currentUser?.deptId) || {};
    const deptCode = resolveDeptCode(deptInfo, currentUser?.department);
    return typeof tpl.data === 'function'
      ? tpl.data({
          deptCode,
          fromLabel: deptInfo.name || currentUser?.department || '',
          toLabel: 'TARGET DEPARTMENT',
          subjectLabel: '[ENTER SUBJECT HERE]',
          headName: deptInfo.headName || '',
          headTitle: deptInfo.headTitle || '',
          date: new Date()
        })
      : tpl.data;
  };

  const [pendingTemplateKey, setPendingTemplateKey] = useState(null);

  const applyTemplate = (key) => {
    if (editor && editor.getText().trim().length > 0) {
      setPendingTemplateKey(key);
      return;
    }
    doApplyTemplate(key);
  };

  const doApplyTemplate = (key) => {
    const tpl = templates[key];
    if (!tpl || !editor) return;
    const html = renderTemplateHtml(key);
    editor.commands.setContent(DOMPurify.sanitize(html));
    setTitle(tpl.title);
    setTemplatePickerOpen(false);
    setPendingTemplateKey(null);
    scheduleAutosave(editor.getHTML());
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-2 w-full max-w-lg">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-xl lg:text-2xl font-black text-foreground bg-transparent outline-none border-b-2 border-transparent focus:border-primary/50 transition-all pb-1 w-full"
            placeholder="Document Title..."
          />
          <SaveIndicator saving={saving} />
        </div>
        <div className="w-full lg:w-auto">
          {aiEnabled && (
            <div className="hidden lg:block lg:mb-0 lg:inline-block lg:mr-4">
              <VoiceDictation onTranscript={(text) => {
                if (editor) editor.chain().focus().insertContent(` ${text}`).run();
              }} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 w-full lg:flex lg:items-center lg:gap-4 lg:w-auto">
            <button
              onClick={() => setTemplatePickerOpen(true)}
              className="flex items-center justify-center gap-1.5 bg-white border border-border/60 hover:border-primary/40 hover:bg-muted/30 text-foreground font-black text-[11px] lg:text-sm px-2 lg:px-5 py-3 lg:py-3.5 rounded-xl lg:rounded-2xl transition-all shadow-sm"
            >
              <FileText size={16} className="text-primary shrink-0" />
              <span className="uppercase tracking-widest truncate">Templates</span>
            </button>
            <button
              onClick={onSend}
              className="flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] lg:text-sm px-2 lg:px-6 py-3 lg:py-3.5 rounded-xl lg:rounded-2xl transition-all shadow-xl shadow-amber-600/20"
            >
              <Send size={16} className="shrink-0" />
              <span className="uppercase tracking-widest truncate"><span className="lg:hidden">Send</span><span className="hidden lg:inline">Send to Workflow</span></span>
            </button>
            <ExportMenu
              onExport={(type) => setExportType(type)}
              formats={[
                { type: 'docx', label: 'Export as Word (.doc)', icon: FileText },
                { type: 'pdf', label: 'Export as PDF', icon: File },
                { type: 'html', label: 'Export as HTML', icon: FileText },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="glass bg-slate-100 rounded-2xl shadow-sm relative z-10 flex flex-col border border-border/50 overflow-hidden">
        {/* Advanced MS Word Style Toolbar — grouped into labeled ribbon sections like Word's Home tab */}
        <div className="bg-white border-b border-border/40 px-3 py-2 flex items-stretch gap-2.5 overflow-x-auto custom-scrollbar sticky top-0 z-20 max-w-full">

          {/* Clipboard — cut/copy/paste are OS clipboard interactions with no document-model
              equivalent in TipTap/ProseMirror, so execCommand is the correct tool here, not a shortcut. */}
          <ToolbarGroup label="Clipboard">
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="Cut" onClick={() => { editor?.chain().focus(); document.execCommand('cut'); }} className={TOOLBAR_BTN}><Scissors size={14} /></button>
              <button title="Copy" onClick={() => { editor?.chain().focus(); document.execCommand('copy'); }} className={TOOLBAR_BTN}><Copy size={14} /></button>
              <button title="Paste" onClick={() => { editor?.chain().focus(); document.execCommand('paste'); }} className={TOOLBAR_BTN}><Clipboard size={14} /></button>
            </div>
          </ToolbarGroup>

          <div className="w-px bg-border/40 shrink-0"></div>

          {/* Font */}
          <ToolbarGroup label="Font">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <select
                  onChange={(e) => editor?.chain().focus().setFontFamily(e.target.value).run()}
                  className="h-7 bg-muted/50 border border-border/40 rounded px-1.5 text-[10px] font-bold outline-none hover:bg-muted"
                >
                  {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select
                  onChange={(e) => editor?.chain().focus().setFontSize(`${e.target.value}pt`).run()}
                  className="h-7 bg-muted/50 border border-border/40 rounded px-1.5 text-[10px] font-bold outline-none hover:bg-muted"
                >
                  <option value="">Size</option>
                  {FONT_SIZES.map(s => <option key={s} value={s}>{s}pt</option>)}
                </select>
              </div>
              <div className="flex items-center gap-0.5">
                <button title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()} className={`p-1 font-black rounded w-7 h-7 flex items-center justify-center text-xs hover:bg-muted ${activeStates.bold ? TOOLBAR_BTN_ACTIVE : ''}`}>B</button>
                <button title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()} className={`p-1 italic rounded w-7 h-7 flex items-center justify-center font-serif text-xs hover:bg-muted ${activeStates.italic ? TOOLBAR_BTN_ACTIVE : ''}`}>I</button>
                <button title="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()} className={`p-1 underline rounded w-7 h-7 flex items-center justify-center text-xs hover:bg-muted ${activeStates.underline ? TOOLBAR_BTN_ACTIVE : ''}`}>U</button>
                <button title="Strikethrough" onClick={() => editor?.chain().focus().toggleStrike().run()} className={`p-1 line-through rounded w-7 h-7 flex items-center justify-center text-xs hover:bg-muted ${activeStates.strike ? TOOLBAR_BTN_ACTIVE : ''}`}>S</button>
                <button title="Subscript" onClick={() => editor?.chain().focus().toggleSubscript().run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center text-[10px] hover:bg-muted ${activeStates.subscript ? TOOLBAR_BTN_ACTIVE : ''}`}>X<sub>2</sub></button>
                <button title="Superscript" onClick={() => editor?.chain().focus().toggleSuperscript().run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center text-[10px] hover:bg-muted ${activeStates.superscript ? TOOLBAR_BTN_ACTIVE : ''}`}>X<sup>2</sup></button>
                <div className="flex flex-col items-center ml-1">
                  <input title="Text Color" type="color" onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()} className="w-5 h-5 p-0 border-none bg-transparent cursor-pointer" />
                  <span className="text-[7px] font-black uppercase opacity-60">Text</span>
                </div>
                <div className="flex flex-col items-center">
                  <input title="Highlight Color" type="color" onChange={(e) => editor?.chain().focus().toggleHighlight({ color: e.target.value }).run()} className="w-5 h-5 p-0 border-none bg-transparent cursor-pointer" />
                  <span className="text-[7px] font-black uppercase opacity-60">Highlight</span>
                </div>
              </div>
            </div>
          </ToolbarGroup>

          <div className="w-px bg-border/40 shrink-0"></div>

          {/* Paragraph */}
          <ToolbarGroup label="Paragraph">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-0.5">
                <button title="Bullet List" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center text-xs hover:bg-muted ${activeStates.bulletList ? TOOLBAR_BTN_ACTIVE : ''}`}>●</button>
                <button title="Number List" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center text-xs hover:bg-muted ${activeStates.orderedList ? TOOLBAR_BTN_ACTIVE : ''}`}>1.</button>
                <button title="Decrease Indent" disabled={!activeStates.canLiftList} onClick={() => editor?.chain().focus().liftListItem('listItem').run()} className="p-1 hover:bg-muted rounded w-7 h-7 flex items-center justify-center text-[10px] disabled:opacity-30">⇤</button>
                <button title="Increase Indent" disabled={!activeStates.canSinkList} onClick={() => editor?.chain().focus().sinkListItem('listItem').run()} className="p-1 hover:bg-muted rounded w-7 h-7 flex items-center justify-center text-[10px] disabled:opacity-30">⇥</button>
              </div>
              <div className="flex items-center gap-0.5">
                <button title="Align Left" onClick={() => editor?.chain().focus().setTextAlign('left').run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center hover:bg-muted ${activeStates.alignLeft ? TOOLBAR_BTN_ACTIVE : ''}`}><i className="text-[10px] font-black">L</i></button>
                <button title="Align Center" onClick={() => editor?.chain().focus().setTextAlign('center').run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center hover:bg-muted ${activeStates.alignCenter ? TOOLBAR_BTN_ACTIVE : ''}`}><i className="text-[10px] font-black">C</i></button>
                <button title="Align Right" onClick={() => editor?.chain().focus().setTextAlign('right').run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center hover:bg-muted ${activeStates.alignRight ? TOOLBAR_BTN_ACTIVE : ''}`}><i className="text-[10px] font-black">R</i></button>
                <button title="Justify" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} className={`p-1 rounded w-7 h-7 flex items-center justify-center hover:bg-muted ${activeStates.alignJustify ? TOOLBAR_BTN_ACTIVE : ''}`}><i className="text-[10px] font-black">J</i></button>
              </div>
            </div>
          </ToolbarGroup>

          <div className="w-px bg-border/40 shrink-0"></div>

          {/* Styles */}
          <ToolbarGroup label="Styles">
            <select
              onChange={(e) => setBlockType(e.target.value)}
              value={activeStates.blockType || 'paragraph'}
              className="h-8 bg-muted/50 border border-border/40 rounded px-1.5 text-[10px] font-bold outline-none hover:bg-muted"
            >
              {HEADING_STYLES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </ToolbarGroup>

          <div className="w-px bg-border/40 shrink-0"></div>

          {/* Insert */}
          <ToolbarGroup label="Insert">
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="Insert Link" onClick={insertLink} className={`p-1.5 rounded w-8 h-8 flex items-center justify-center text-xs hover:bg-muted ${activeStates.link ? TOOLBAR_BTN_ACTIVE : ''}`}>🔗</button>
              <button title="Insert Table" onClick={insertTable} className={TOOLBAR_BTN}><Table size={14} /></button>
              <div className="relative">
                <button
                  title="Insert Image"
                  onClick={() => setImgPickerOpen(o => !o)}
                  className={`p-1.5 rounded w-8 h-8 flex items-center justify-center hover:bg-muted ${imgPickerOpen ? TOOLBAR_BTN_ACTIVE : ''}`}
                >
                  <ImageIcon size={14} />
                </button>
                {imgPickerOpen && (
                  <div className="absolute top-full left-0 mt-1 w-64 z-50 bg-white border border-border/50 rounded-2xl shadow-xl p-3 space-y-2">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Pick from Image Library</p>
                    <ImagePickerDropdown
                      value={imgPickerVal}
                      onChange={url => setImgPickerVal(url)}
                      placeholder="Choose an image…"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        disabled={!imgPickerVal}
                        onClick={() => {
                          if (imgPickerVal) {
                            editor?.chain().focus().setImage({ src: imgPickerVal }).run();
                            setImgPickerVal('');
                            setImgPickerOpen(false);
                          }
                        }}
                        className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
                      >
                        Insert
                      </button>
                      <button onClick={() => { setImgPickerOpen(false); setImgPickerVal(''); }} className="px-3 py-2 rounded-xl border border-border/40 text-muted-foreground text-[10px] font-bold hover:bg-muted/60 transition-all">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ToolbarGroup>

          <div className="w-px bg-border/40 shrink-0"></div>

          {/* Editing */}
          <ToolbarGroup label="Editing">
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="Clear Formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} className={TOOLBAR_BTN}><Eraser size={14} /></button>
              <button title="Find & Replace" onClick={() => setFindOpen(o => !o)} className={`${TOOLBAR_BTN} ${findOpen ? TOOLBAR_BTN_ACTIVE : ''}`}><Search size={14} /></button>
              <button title="Undo" disabled={!activeStates.canUndo} onClick={() => editor?.chain().focus().undo().run()} className="p-1.5 hover:bg-muted rounded w-8 h-8 flex items-center justify-center disabled:opacity-30">↶</button>
              <button title="Redo" disabled={!activeStates.canRedo} onClick={() => editor?.chain().focus().redo().run()} className="p-1.5 hover:bg-muted rounded w-8 h-8 flex items-center justify-center disabled:opacity-30">↷</button>
            </div>
          </ToolbarGroup>
        </div>

        {findOpen && (
          <div className="bg-amber-50 border-b border-amber-200/60 px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <Search size={14} className="text-amber-700 shrink-0" />
            <input
              autoFocus
              value={findTerm}
              onChange={(e) => runSearch(e.target.value)}
              placeholder="Find in document..."
              className="h-8 px-2.5 rounded-lg border border-amber-300/60 bg-white text-xs outline-none focus:border-amber-500 w-48"
            />
            <span className="text-[10px] font-bold text-amber-700/70 whitespace-nowrap">
              {findTerm ? (matchCount > 0 ? `${activeMatchIndex + 1} of ${matchCount}` : 'No results') : ''}
            </span>
            <button title="Previous match" disabled={!matchCount} onClick={() => editor?.commands.goToMatch(-1)} className="p-1.5 hover:bg-amber-100 rounded disabled:opacity-30">↑</button>
            <button title="Next match" disabled={!matchCount} onClick={() => editor?.commands.goToMatch(1)} className="p-1.5 hover:bg-amber-100 rounded disabled:opacity-30">↓</button>
            <button
              onClick={() => setFindReplaceMode(m => !m)}
              className="text-[10px] font-bold text-amber-700 hover:text-amber-900 underline underline-offset-2"
            >
              {findReplaceMode ? 'Hide Replace' : 'Replace'}
            </button>
            {findReplaceMode && (
              <>
                <input
                  value={replaceTerm}
                  onChange={(e) => setReplaceTerm(e.target.value)}
                  placeholder="Replace with..."
                  className="h-8 px-2.5 rounded-lg border border-amber-300/60 bg-white text-xs outline-none focus:border-amber-500 w-40"
                />
                <button disabled={!matchCount} onClick={() => editor?.commands.replaceCurrentMatch(replaceTerm)} className="px-3 h-8 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase disabled:opacity-40">Replace</button>
                <button disabled={!matchCount} onClick={() => editor?.commands.replaceAllMatches(replaceTerm)} className="px-3 h-8 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[10px] font-black uppercase disabled:opacity-40">Replace All</button>
              </>
            )}
            <button onClick={closeFind} className="ml-auto p-1.5 hover:bg-amber-100 rounded"><X size={14} /></button>
          </div>
        )}

        {/* TipTap-managed contentEditable surface */}
        <div className="editor-outer-shell">
          <EditorContent editor={editor} className="h-full" />
        </div>
      </div>

      <ExportConfirmModal
        open={!!exportType}
        title={`Export "${title}" as ${exportType === 'docx' ? 'Word (.doc)' : exportType === 'pdf' ? 'PDF' : 'HTML'}`}
        exporting={exporting}
        onConfirm={handleConfirmExport}
        onClose={() => setExportType(null)}
      >
        <div
          className="bg-white border border-border/40 rounded-xl shadow-sm p-8 max-h-[55vh] overflow-y-auto custom-scrollbar"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editor?.getHTML() || '') }}
        />
      </ExportConfirmModal>

      {templatePickerOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between shrink-0">
              <h3 className="font-black text-lg text-foreground">Choose a Template</h3>
              <button onClick={() => setTemplatePickerOpen(false)} className="p-1.5 hover:bg-muted rounded-lg"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-muted/20 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(templates).map(([key, tpl]) => (
                  <button
                    key={key}
                    onClick={() => applyTemplate(key)}
                    className="text-left bg-white border border-border/50 hover:border-primary/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all group"
                  >
                    <div className="h-64 overflow-hidden bg-muted/30 border-b border-border/40 relative">
                      <div
                        className="origin-top-left scale-[0.42] w-[238%] pointer-events-none p-2"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderTemplateHtml(key)) }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-transparent to-transparent" />
                    </div>
                    <div className="p-4">
                      <p className="font-black text-sm text-foreground group-hover:text-primary transition-colors">{tpl.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{tpl.sample}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingTemplateKey}
        onClose={() => setPendingTemplateKey(null)}
        onConfirm={() => doApplyTemplate(pendingTemplateKey)}
        title="Replace Document Content?"
        message="This will replace the current content with the selected template. This cannot be undone."
        confirmText="Replace Content"
        cancelText="Keep Current Content"
        type="warning"
      />
    </div>
  );
};

export default RichTextEditor;

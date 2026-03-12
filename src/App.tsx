/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { 
  FileText, 
  Send, 
  ShieldCheck, 
  AlertCircle, 
  Users, 
  ClipboardList, 
  Download, 
  Save,
  Loader2,
  CheckCircle2,
  Info,
  Mic,
  MicOff,
  RotateCcw,
  RotateCw,
  FileJson,
  ChevronDown,
  ChevronUp,
  Copy,
  FileDown,
  LogOut,
  User,
  Lock,
  ShieldAlert,
  LogIn,
  Upload,
  FileAudio,
  Image as ImageIcon,
  X,
  ExternalLink,
  Zap,
  Sparkles,
  Scale,
  Activity,
  Calendar,
  LayoutDashboard,
  CheckSquare,
  Settings,
  MessageSquare,
  History,
  FileSearch
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  onSnapshot,
  handleFirestoreError,
  OperationType
} from './firebase';
import { piiService } from './services/piiService';

// --- Types ---

type CaseType = 
  | 'Investigation' 
  | 'Removal' 
  | 'Permanency' 
  | 'Judicial Review' 
  | 'Court Affidavit' 
  | 'Other';

type OutputFormat = 'Plain Text' | 'PDF-ready' | 'Sectioned Outline';

interface CaseData {
  reportTitle: string;
  caseNotes: string;
  caseType: CaseType;
  childInfo: string;
  state: string;
  supervisorMode: boolean;
  outputFormat: OutputFormat;
  attachments: AttachedFile[];
}

interface AttachedFile {
  id: string;
  file: File;
  type: 'image' | 'audio';
  previewUrl: string;
  base64?: string;
}

// --- App Component ---

export default function App() {
  const [caseData, setCaseData] = useState<CaseData>({
    reportTitle: '',
    caseNotes: '',
    caseType: 'Investigation',
    childInfo: '',
    state: 'Ohio',
    supervisorMode: false,
    outputFormat: 'Plain Text',
    attachments: [],
  });

  const [report, setReport] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isListening, setIsListening] = useState(false);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'caseworker' | 'supervisor' | 'admin'>('caseworker');
  const [currentView, setCurrentView] = useState<'editor' | 'supervisor' | 'admin'>('editor');
  const [pendingReports, setPendingReports] = useState<any[]>([]);
  const [agencyTemplates, setAgencyTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  
  const reportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          const userDoc = await getDoc(userRef);
          let role = 'caseworker';
          
          if (userDoc.exists()) {
            role = userDoc.data().role || 'caseworker';
          } else {
            // Default admin for the main user
            if (firebaseUser.email === "dain.russell@gmail.com") {
              role = 'admin';
            }
            await setDoc(userRef, {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              role: role,
              lastLogin: serverTimestamp()
            }, { merge: true });
          }
          
          setUser(firebaseUser);
          setUserRole(role as any);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setUser(null);
        setUserRole('caseworker');
        setCurrentView('editor');
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch pending reports for supervisor
  useEffect(() => {
    if (user && userRole === 'supervisor') {
      const q = query(collection(db, 'reports'), where('status', '==', 'pending'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPendingReports(reports);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, 'reports');
      });
      return () => unsubscribe();
    }
  }, [user, userRole]);

  // Fetch templates
  useEffect(() => {
    if (user) {
      const q = query(collection(db, 'templates'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAgencyTemplates(templates);
        if (templates.length > 0 && !selectedTemplate) {
          setSelectedTemplate(templates[0]);
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, 'templates');
      });
      return () => unsubscribe();
    }
  }, [user]);
  useEffect(() => {
    if (!user) return;

    const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutes
    
    const checkInactivity = () => {
      if (Date.now() - lastActivity > INACTIVITY_LIMIT) {
        handleLogout();
        setError("Session expired due to inactivity. Please log in again.");
      }
    };

    const interval = setInterval(checkInactivity, 60000); // Check every minute
    
    const updateActivity = () => setLastActivity(Date.now());
    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
    };
  }, [user, lastActivity]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login error:", err);
      setError("Failed to sign in. Please try again.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCaseData({
        reportTitle: '',
        caseNotes: '',
        caseType: 'Investigation',
        childInfo: '',
        state: 'Ohio',
        supervisorMode: false,
        outputFormat: 'Plain Text',
        attachments: [],
      });
      setReport('');
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const logAuditAction = async (action: string, details: any = {}) => {
    if (!user) return;
    const path = 'auditLogs';
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        userEmail: user.email,
        timestamp: serverTimestamp(),
        action,
        ...details
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  // Load draft on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem('cps_report_draft');
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        // Ensure all required fields exist, especially attachments which might be missing in older drafts
        setCaseData(prev => ({
          ...prev,
          ...parsed,
          state: parsed.state || 'Ohio',
          attachments: parsed.attachments || []
        }));
        if (parsed.caseNotes) {
          setHistory([parsed.caseNotes]);
        }
      } catch (err) {
        console.error("Failed to parse saved draft", err);
      }
    }

    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        if (!event.results) return;
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setCaseData(prev => ({
            ...prev,
            caseNotes: prev.caseNotes + (prev.caseNotes ? ' ' : '') + finalTranscript
          }));
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    
    autoSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem('cps_report_draft', JSON.stringify(caseData));
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [caseData]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (err) {
        console.error("Failed to start speech recognition", err);
        setError("Speech recognition is not supported or permission was denied.");
      }
    }
  };

  const loadExample = () => {
    const example: CaseData = {
      reportTitle: 'Initial Investigation - Johnson Family (Alleged Neglect)',
      caseNotes: `Home visit conducted on 03/12/2026. Observed three children (ages 4, 6, 8) in the home. The home was cluttered with trash and old food. Mother (Sarah Johnson) appeared lethargic and had difficulty focusing on questions. Children appeared thin but were appropriately dressed for the weather. 6-year-old reported they haven't had a "hot meal" in two days. Sarah admitted to struggling with depression and lack of support since her partner left. No immediate signs of physical abuse, but severe environmental neglect is evident. Safety plan discussed but Sarah was hesitant to sign.`,
      caseType: 'Investigation',
      childInfo: 'Aria (8), Leo (6), Mia (4)',
      state: 'Ohio',
      supervisorMode: false,
      outputFormat: 'Plain Text',
      attachments: [],
    };
    setCaseData(example);
    addToHistory(example.caseNotes);
    setError(null);
    setFieldErrors({});
  };

  const addToHistory = (newNotes: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newNotes);
    if (newHistory.length > 50) newHistory.shift(); // Limit history
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prevNotes = history[historyIndex - 1];
      setCaseData(prev => ({ ...prev, caseNotes: prevNotes }));
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextNotes = history[historyIndex + 1];
      setCaseData(prev => ({ ...prev, caseNotes: nextNotes }));
      setHistoryIndex(historyIndex + 1);
    }
  };

  const saveDraft = () => {
    setIsSaving(true);
    localStorage.setItem('cps_report_draft', JSON.stringify(caseData));
    setTimeout(() => setIsSaving(false), 1500);
  };

  const submitForReview = async () => {
    if (!validate()) return;
    if (!user) {
      setError("You must be signed in to submit for review.");
      return;
    }

    setIsSaving(true);
    const path = 'reports';
    try {
      await addDoc(collection(db, path), {
        title: caseData.reportTitle || `Report - ${new Date().toLocaleDateString()}`,
        notes: caseData.caseNotes,
        caseType: caseData.caseType,
        state: caseData.state,
        childInfo: caseData.childInfo,
        status: 'pending',
        caseworkerId: user.uid,
        caseworkerEmail: user.email,
        generatedReport: report || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      await logAuditAction('submit_for_review', { title: caseData.reportTitle });
      alert("Report submitted for supervisor review.");
      setReport(null);
      setCaseData(prev => ({ ...prev, caseNotes: '', reportTitle: '' }));
      localStorage.removeItem('cps_report_draft');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement>
  ) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    
    setCaseData(prev => ({
      ...prev,
      [name]: val,
    }));

    if (name === 'caseNotes' && typeof val === 'string') {
      // Debounce history updates would be better, but for now simple:
      if (Math.abs(val.length - (history[historyIndex]?.length || 0)) > 10) {
        addToHistory(val);
      }
    }

    // Clear field error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!caseData.caseNotes.trim()) {
      errors.caseNotes = "Case notes are required to generate a report.";
    } else if (caseData.caseNotes.trim().length < 20) {
      errors.caseNotes = "Please provide more detailed case notes (at least 20 characters).";
    }

    if (!caseData.caseType) {
      errors.caseType = "Please select a case type.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: AttachedFile[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith('image/');
      const isAudio = file.type.startsWith('audio/') || file.name.endsWith('.m4a');
      
      if (!isImage && !isAudio) {
        setError("Unsupported file type. Please upload images or audio files.");
        continue;
      }

      const base64 = await fileToBase64(file);
      
      newAttachments.push({
        id: Math.random().toString(36).substr(2, 9),
        file,
        type: isImage ? 'image' : 'audio',
        previewUrl: isImage ? URL.createObjectURL(file) : '',
        base64: base64.split(',')[1] // Remove data:mime/type;base64,
      });
    }

    setCaseData(prev => ({
      ...prev,
      attachments: [...(prev.attachments || []), ...newAttachments]
    }));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const removeAttachment = (id: string) => {
    setCaseData(prev => ({
      ...prev,
      attachments: (prev.attachments || []).filter(a => a.id !== id)
    }));
  };

  const generateReport = async () => {
    if (!validate()) {
      setError("Please fix the errors in the form before generating.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 1. PII Redaction (Local)
      const entitiesToRedact = caseData.childInfo.split(',').map(e => e.trim());
      const { redactedText: redactedNotes, map: notesMap } = piiService.redact(caseData.caseNotes);
      const { redactedText: finalRedactedNotes, map: entityMap } = piiService.redactEntities(redactedNotes, entitiesToRedact);
      
      const combinedMap = { ...notesMap, ...entityMap };
      const redactedData = { ...caseData, caseNotes: finalRedactedNotes };

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      // Prepare multimodal parts
      const parts: any[] = [
        { text: constructPrompt(redactedData) }
      ];

      // Add attachments
      (caseData.attachments || []).forEach(attr => {
        parts.push({
          inlineData: {
            mimeType: attr.file.type || (attr.file.name.endsWith('.m4a') ? 'audio/mp4' : 'application/octet-stream'),
            data: attr.base64
          }
        });
      });

      const model = ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            role: "user",
            parts: parts
          }
        ],
        config: {
          systemInstruction: selectedTemplate 
            ? selectedTemplate.systemInstruction 
            : `You are a Child Welfare AI Assistant, called "Child Welfare Copilot". 
Your role is to help CPS caseworkers and supervisors create accurate, compliant, and structured case documentation, generate court reports, flag risk and missing information, and suggest family support resources.

ADVANCED CAPABILITIES:
1. Quantitative Risk Scoring: Calculate a "Risk Matrix Score" (1-10) based on keywords like substance use, prior history, domestic violence, and environmental neglect. Provide a brief justification for the score.
2. Timeline Generator: Extract all dates/times from the notes and images to create a "Chronological Timeline of Events" section.
3. Statute/Policy Referencing: Automatically cite relevant state laws based on the allegations described. Use the specific statutes and codes for the selected state: ${caseData.state}. (e.g., if Ohio is selected, use Ohio Revised Code; if California is selected, use California Welfare and Institutions Code, etc.).

IMPORTANT PRIVACY NOTICE: The input text has been redacted to protect PII. You will see placeholders like [PERSON_1], [SSN_1], [PHONE_1]. Maintain these placeholders exactly in your output. Do not attempt to guess or hallucinate the original values.

MULTIMODAL INSTRUCTIONS:
1. If images are provided (e.g., photos of notes, police reports, medical docs), extract all relevant facts, dates, and names into the report. Redact any new names found in images using the [PERSON_X] pattern.
2. If audio is provided (e.g., interview recordings), transcribe the key points and summarize the dialogue. Redact any PII mentioned in the audio.
3. Integrate all information from text, images, and audio into a single, cohesive, professional report.`,
        }
      });

      const response = await model;
      const rawText = response.text;
      
      if (rawText) {
        // 2. Restore PII (Local)
        const restoredText = piiService.restore(rawText, combinedMap);
        setReport(restoredText);
        
        // 3. Audit Log
        await logAuditAction('generate_report', {
          caseType: caseData.caseType,
          reportTitle: caseData.reportTitle
        });

        // Scroll to report after a short delay to allow rendering
        setTimeout(() => {
          reportRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        throw new Error("No response generated from AI.");
      }
    } catch (err) {
      console.error("Generation error:", err);
      setError("Failed to generate report. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const constructPrompt = (data: CaseData) => {
    let formatInstruction = "";
    if (data.outputFormat === 'PDF-ready') {
      formatInstruction = "Format the output with clear page breaks (using horizontal rules ---), formal headers, and a layout suitable for a professional PDF document.";
    } else if (data.outputFormat === 'Sectioned Outline') {
      formatInstruction = "Format the output as a detailed, hierarchical outline with numbered sections and sub-points.";
    } else {
      formatInstruction = "Format the output as a standard professional report with clear headings and paragraphs.";
    }

    const titleLine = data.reportTitle ? `# ${data.reportTitle}\n\n` : "";

    return `
${titleLine}USER INPUT VARIABLES:
- Case Notes: ${data.caseNotes}
- Case Type: ${data.caseType}
- State/Jurisdiction: ${data.state}
- Child & Family Info: ${data.childInfo || "Not provided"}
- Supervisor Review Mode: ${data.supervisorMode}
- Requested Output Format: ${data.outputFormat}

INSTRUCTIONS:
${formatInstruction}

AI TASKS / WORKFLOW:
1. Summarize Case Notes: Extract key facts and identify risk indicators.
2. Quantitative Risk Assessment: Generate a "Risk Matrix Score" with justification.
3. Chronological Timeline: Extract and list all events with dates/times in order.
4. Statute Referencing: Cite relevant statutes and legal codes for the state of ${data.state} based on the case details.
5. Generate Structured Report: Include Background, Allegations, Investigation Summary, Safety Assessment, Actions Taken, and Recommendations.
6. Supervisor Review / QA: If Supervisor Review Mode is true, highlight missing sections and flag high-risk issues.
7. Family Services Recommendation: Suggest evidence-based programs.
8. Output Formatting: Use clear headings and bullet points.
`;
  };

  const copyToClipboard = () => {
    if (report) {
      navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadTXT = () => {
    if (!report) return;
    const element = document.createElement("a");
    const file = new Blob([report], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${caseData.reportTitle || 'CPS_Report'}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const parseReportSections = (text: string) => {
    const sections: { title: string; content: string }[] = [];
    const lines = text.split('\n');
    let currentSection: { title: string; content: string } | null = null;

    lines.forEach(line => {
      if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ')) {
        if (currentSection) sections.push(currentSection);
        currentSection = { 
          title: line.replace(/^#+\s+/, ''), 
          content: '' 
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else if (line.trim()) {
        // Handle content before first header
        currentSection = { title: 'Introduction', content: line + '\n' };
      }
    });

    if (currentSection) sections.push(currentSection);
    return sections;
  };

  const toggleSection = (title: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  const wordCount = caseData.caseNotes.trim() ? caseData.caseNotes.trim().split(/\s+/).length : 0;
  const charCount = caseData.caseNotes.length;

  const downloadPDF = async () => {
    if (!contentRef.current || !report) return;
    
    setIsDownloading(true);
    try {
      const element = contentRef.current;
      const safeTitle = caseData.reportTitle 
        ? caseData.reportTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() 
        : 'CPS_Report';
      
      const opt = {
        margin: [15, 15],
        filename: `${safeTitle}_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      } as any;

      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("PDF generation error:", err);
      setError("Failed to generate PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mx-auto" />
          <p className="text-sm font-medium text-gray-500">Verifying Secure Session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-black/5 overflow-hidden"
        >
          <div className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-200">
              <ShieldCheck className="w-12 h-12 text-white" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">Child Welfare Copilot</h1>
              <p className="text-gray-500 text-sm">Secure Case Management & Reporting System</p>
            </div>
            
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3 text-left">
              <Lock className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                This system is for authorized Cabell County CPS personnel only. All actions are logged for CJIS/HIPAA compliance.
              </p>
            </div>

            <button 
              onClick={handleLogin}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-4 rounded-xl shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-3"
            >
              <LogIn className="w-5 h-5" />
              Caseworker Login
            </button>
            
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
              Department of Health and Human Resources
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Child Welfare Copilot</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Cabell County CPS Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1 bg-gray-100 p-1 rounded-xl mr-4">
              <button 
                onClick={() => setCurrentView('editor')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${currentView === 'editor' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <FileSearch className="w-3.5 h-3.5" />
                Editor
              </button>
              {(userRole === 'supervisor' || userRole === 'admin') && (
                <button 
                  onClick={() => setCurrentView('supervisor')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${currentView === 'supervisor' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Dashboard
                  {pendingReports.length > 0 && (
                    <span className="bg-red-500 text-white text-[8px] px-1.5 py-0.5 rounded-full">{pendingReports.length}</span>
                  )}
                </button>
              )}
              {userRole === 'admin' && (
                <button 
                  onClick={() => setCurrentView('admin')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${currentView === 'admin' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Templates
                </button>
              )}
            </nav>
            <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
              <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center overflow-hidden">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-3 h-3 text-emerald-600" />
                )}
              </div>
              <span className="text-xs font-semibold text-gray-700">{user.displayName}</span>
              <button 
                onClick={handleLogout}
                className="p-1 hover:text-red-600 transition-colors"
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            <button 
              onClick={loadExample}
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100"
            >
              <FileJson className="w-3.5 h-3.5" />
              Load Example Case
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'editor' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Input Section */}
          <div className="lg:col-span-5 space-y-6">
            {/* Workflow Integration Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-3xl shadow-sm border border-black/5 p-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-lg">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-lg font-bold tracking-tight">Workflow Integration</h2>
                </div>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full uppercase tracking-wider">
                  SACWIS/CCWIS Bridge
                </span>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Connect your generated reports directly to the state web portal. Use the browser extension to auto-fill fields.
                </p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    onClick={() => {
                      if (report) {
                        navigator.clipboard.writeText(report);
                        alert("Report copied to extension bridge. Ready for auto-fill in SACWIS/CCWIS.");
                      }
                    }}
                    disabled={!report}
                    className="flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Push to State Portal
                  </button>
                  <a 
                    href="#" 
                    className="flex items-center justify-center gap-2 py-3 bg-white border border-black/5 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Get Extension
                  </a>
                </div>
              </div>
            </motion.div>

            <section className="bg-white rounded-2xl shadow-sm border border-black/5 p-6 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardList className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-medium">Case Details</h2>
              </div>

              <div className="space-y-4">
                {/* Report Title */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Report Title (Optional)
                  </label>
                  <input
                    type="text"
                    name="reportTitle"
                    placeholder="e.g., Initial Investigation - Smith Family"
                    value={caseData.reportTitle}
                    onChange={handleInputChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                  />
                </div>

                {/* Case Type */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Case Type
                  </label>
                  <select
                    name="caseType"
                    value={caseData.caseType}
                    onChange={handleInputChange}
                    className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-sm outline-none transition-all ${
                      fieldErrors.caseType 
                        ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' 
                        : 'border-gray-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                    }`}
                  >
                    <option value="">Select Case Type...</option>
                    <option>Investigation</option>
                    <option>Removal</option>
                    <option>Permanency</option>
                    <option>Judicial Review</option>
                    <option>Court Affidavit</option>
                    <option>Other</option>
                  </select>
                  {fieldErrors.caseType && (
                    <p className="mt-1 text-xs text-red-600 font-medium">{fieldErrors.caseType}</p>
                  )}
                </div>

                {/* State/Jurisdiction */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    State / Jurisdiction
                  </label>
                  <select
                    name="state"
                    value={caseData.state}
                    onChange={handleInputChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                  >
                    {[
                      'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
                      'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
                      'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
                      'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
                      'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
                      'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
                    ].map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>

                {/* Child & Family Info */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Child & Family Info (Optional)
                  </label>
                  <input
                    type="text"
                    name="childInfo"
                    placeholder="Names, ages, demographics..."
                    value={caseData.childInfo}
                    onChange={handleInputChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                  />
                </div>

                {/* Case Notes */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Raw Case Notes
                    </label>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={undo}
                        disabled={historyIndex <= 0}
                        className="p-1 text-gray-400 hover:text-emerald-600 disabled:opacity-30 transition-colors"
                        title="Undo"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={redo}
                        disabled={historyIndex >= history.length - 1}
                        className="p-1 text-gray-400 hover:text-emerald-600 disabled:opacity-30 transition-colors"
                        title="Redo"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={toggleListening}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-tighter transition-all ${
                          isListening 
                            ? 'bg-red-100 text-red-600 animate-pulse' 
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                        {isListening ? 'Stop' : 'Dictate'}
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <textarea
                      name="caseNotes"
                      rows={10}
                      placeholder="Enter observations, interviews, and findings here..."
                      value={caseData.caseNotes}
                      onChange={handleInputChange}
                      className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-sm outline-none transition-all resize-none ${
                        fieldErrors.caseNotes 
                          ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' 
                          : 'border-gray-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                      }`}
                    />
                    
                    {/* Multimodal Uploads */}
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                      <div className="flex items-center gap-2 text-[10px] font-medium text-gray-400 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-md border border-gray-100">
                        <span>{wordCount} Words</span>
                        <span className="w-px h-2 bg-gray-200" />
                        <span>{charCount} Characters</span>
                      </div>
                      
                      <label className="cursor-pointer p-1.5 bg-white rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500 hover:text-emerald-600" title="Upload Audio/Images">
                        <Upload className="w-3.5 h-3.5" />
                        <input 
                          type="file" 
                          className="hidden" 
                          multiple 
                          accept="image/*,audio/*,.m4a"
                          onChange={handleFileUpload}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Attachments Preview */}
                  <AnimatePresence>
                    {(caseData.attachments || []).length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-2 pt-2"
                      >
                        {(caseData.attachments || []).map((attr) => (
                          <div key={attr.id} className="relative group">
                            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1.5 pr-6 shadow-sm">
                              {attr.type === 'image' ? (
                                <div className="w-6 h-6 rounded-md overflow-hidden border border-gray-100">
                                  <img src={attr.previewUrl} alt="" className="w-full h-full object-cover" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 bg-blue-50 rounded-md flex items-center justify-center">
                                  <FileAudio className="w-3 h-3 text-blue-600" />
                                </div>
                              )}
                              <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-gray-700 truncate max-w-[80px]">{attr.file.name}</span>
                                <span className="text-[7px] text-gray-400 uppercase font-bold">{attr.type}</span>
                              </div>
                            </div>
                            <button 
                              onClick={() => removeAttachment(attr.id)}
                              className="absolute top-0.5 right-0.5 p-0.5 bg-white rounded-full shadow-sm border border-gray-100 text-gray-400 hover:text-red-600 transition-colors"
                            >
                              <X className="w-2 h-2" />
                            </button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {fieldErrors.caseNotes && (
                    <p className="mt-1 text-xs text-red-600 font-medium">{fieldErrors.caseNotes}</p>
                  )}
                </div>

                {/* Options */}
                <div className="flex flex-wrap gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        name="supervisorMode"
                        checked={caseData.supervisorMode}
                        onChange={handleInputChange}
                        className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-gray-300 transition-all checked:bg-emerald-600 checked:border-emerald-600"
                      />
                      <CheckCircle2 className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 left-0.5 pointer-events-none" />
                    </div>
                    <span className="text-sm font-medium text-gray-700 group-hover:text-emerald-700 transition-colors">
                      Supervisor Review Mode
                    </span>
                  </label>
                </div>

                {/* Output Format */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Output Format
                  </label>
                  <div className="flex gap-2">
                    {(['Plain Text', 'PDF-ready', 'Sectioned Outline'] as OutputFormat[]).map((format) => (
                      <button
                        key={format}
                        onClick={() => setCaseData(prev => ({ ...prev, outputFormat: format }))}
                        className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
                          caseData.outputFormat === format
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Advanced AI Features Info */}
                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Advanced AI Active</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { icon: Scale, label: 'Statute Referencing (ORC)', color: 'text-blue-600', bg: 'bg-blue-50' },
                      { icon: Activity, label: 'Quantitative Risk Scoring', color: 'text-red-600', bg: 'bg-red-50' },
                      { icon: Calendar, label: 'Automated Timeline Generator', color: 'text-purple-600', bg: 'bg-purple-50' },
                    ].map((feature, idx) => (
                      <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${feature.bg} border border-black/5`}>
                        <feature.icon className={`w-3.5 h-3.5 ${feature.color}`} />
                        <span className="text-[10px] font-semibold text-gray-600">{feature.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-sm"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <div className="flex flex-col gap-3">
                  <button
                    onClick={generateReport}
                    disabled={isGenerating}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-3 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating Report...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Generate Professional Report
                      </>
                    )}
                  </button>

                  <button
                    onClick={saveDraft}
                    disabled={isSaving}
                    className="w-full bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    {isSaving ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Draft Saved
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 text-gray-400" />
                        Save Draft
                      </>
                    )}
                  </button>

                  <button
                    onClick={submitForReview}
                    disabled={isSaving || isGenerating}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-xl shadow-lg shadow-blue-600/10 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    <CheckSquare className="w-4 h-4" />
                    Submit for Supervisor Review
                  </button>
                </div>
              </div>
            </section>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 flex gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 space-y-1">
                <p className="font-semibold">Confidentiality Notice</p>
                <p className="opacity-80">This tool is designed to assist in drafting documentation. Always review and verify all AI-generated content for accuracy before official submission.</p>
              </div>
            </div>
          </div>

          {/* Output Section */}
          <div className="lg:col-span-7" ref={reportRef}>
            <AnimatePresence mode="wait">
              {report ? (
                <motion.div
                  key="report"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl shadow-sm border border-black/5 flex flex-col h-full min-h-[600px]"
                >
                  <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50/50 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      <h2 className="font-medium">Generated Report</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={downloadPDF}
                        disabled={isDownloading}
                        className="p-2 rounded-lg border border-transparent hover:border-gray-200 hover:bg-white transition-all text-gray-600 flex items-center gap-2 text-xs font-medium disabled:opacity-50"
                        title="Download as PDF"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        PDF
                      </button>
                      <button 
                        onClick={downloadTXT}
                        className="p-2 rounded-lg border border-transparent hover:border-gray-200 hover:bg-white transition-all text-gray-600 flex items-center gap-2 text-xs font-medium"
                        title="Download as Plain Text"
                      >
                        <FileDown className="w-4 h-4" />
                        TXT
                      </button>
                      <button 
                        onClick={copyToClipboard}
                        className={`p-2 rounded-lg border transition-all flex items-center gap-2 text-xs font-medium ${
                          copied 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                            : 'hover:bg-white border-transparent hover:border-gray-200 text-gray-600'
                        }`}
                        title="Copy to clipboard"
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div 
                    ref={contentRef}
                    className="p-8 overflow-y-auto prose prose-sm max-w-none prose-emerald prose-headings:font-semibold prose-headings:tracking-tight prose-p:text-gray-700 prose-li:text-gray-700 flex-grow"
                  >
                    <div className="space-y-4 print:space-y-8">
                      {parseReportSections(report).map((section, idx) => (
                        <div key={idx} className="border border-gray-100 rounded-xl overflow-hidden print:border-none print:rounded-none">
                          <button 
                            onClick={() => toggleSection(section.title)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left print:hidden"
                          >
                            <span className="font-semibold text-gray-900">{section.title}</span>
                            {expandedSections[section.title] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          <div className={`p-4 print:block ${expandedSections[section.title] || idx === 0 ? 'block' : 'hidden'}`}>
                            {idx === 0 && !report.startsWith('#') && (
                              <h2 className="text-xl font-bold mb-4 print:block hidden">{section.title}</h2>
                            )}
                            <ReactMarkdown>{section.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-6 border-t border-black/5 bg-gray-50/50 rounded-b-2xl">
                    <button
                      onClick={downloadPDF}
                      disabled={isDownloading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-3 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Preparing PDF...
                        </>
                      ) : (
                        <>
                          <Download className="w-5 h-5" />
                          Download Full Report as PDF
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-12 text-center h-full min-h-[600px]"
                >
                  <div className="bg-gray-50 p-4 rounded-full mb-4">
                    <Users className="w-12 h-12 text-gray-300" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Report Generated Yet</h3>
                  <p className="text-sm text-gray-500 max-w-xs">
                    Fill out the case details and notes on the left to generate a structured, professional report.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        )}

        {currentView === 'supervisor' && (
          <SupervisorDashboard 
            pendingReports={pendingReports} 
            user={user} 
          />
        )}

        {currentView === 'admin' && (
          <AdminSettings 
            agencyTemplates={agencyTemplates} 
            user={user} 
          />
        )}
      </main>
      
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-black/5 mt-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-gray-400 font-medium uppercase tracking-widest">
          <p>© 2026 Child Welfare Copilot • Cabell County WV</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-emerald-600 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">Security Standards</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// --- Sub-Components ---

function SupervisorDashboard({ pendingReports, user }: { pendingReports: any[], user: any }) {
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [comments, setComments] = useState('');

  const handleAction = async (reportId: string, status: 'approved' | 'rejected') => {
    const path = 'reports';
    try {
      await updateDoc(doc(db, path, reportId), {
        status,
        supervisorComments: comments,
        supervisorId: user.uid,
        updatedAt: serverTimestamp()
      });
      alert(`Report ${status} successfully.`);
      setSelectedReport(null);
      setComments('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${path}/${reportId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-emerald-600" />
          Supervisor Review Queue
        </h2>
        <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
          {pendingReports.length} Pending Reviews
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-4">
          {pendingReports.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-dashed border-gray-200 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-200 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">All caught up! No reports pending review.</p>
            </div>
          ) : (
            pendingReports.map(report => (
              <button
                key={report.id}
                onClick={() => setSelectedReport(report)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedReport?.id === report.id ? 'bg-emerald-50 border-emerald-200 shadow-sm' : 'bg-white border-black/5 hover:border-emerald-200'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">{report.caseType}</span>
                  <span className="text-[10px] text-gray-400">{report.createdAt?.toDate() ? new Date(report.createdAt.toDate()).toLocaleDateString() : 'Recent'}</span>
                </div>
                <h3 className="font-bold text-gray-800 mb-1">{report.title}</h3>
                <p className="text-xs text-gray-500 line-clamp-1">By: {report.caseworkerEmail}</p>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-8">
          {selectedReport ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold">{selectedReport.title}</h3>
                  <p className="text-sm text-gray-500">Submitted by {selectedReport.caseworkerEmail}</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleAction(selectedReport.id, 'rejected')}
                    className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all"
                  >
                    Request Changes
                  </button>
                  <button 
                    onClick={() => handleAction(selectedReport.id, 'approved')}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                  >
                    Approve Report
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Supervisor Comments</label>
                  <textarea 
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Add feedback or instructions for the caseworker..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                    rows={3}
                  />
                </div>
                <div className="prose prose-sm max-w-none">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Generated Report Content</label>
                  <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
                    <ReactMarkdown>{selectedReport.generatedReport}</ReactMarkdown>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Original Case Notes</label>
                  <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100 italic">
                    {selectedReport.notes}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-12 text-center h-full min-h-[400px]">
              <FileSearch className="w-12 h-12 text-gray-200 mb-4" />
              <h3 className="text-lg font-medium text-gray-400">Select a report to review</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminSettings({ agencyTemplates, user }: { agencyTemplates: any[], user: any }) {
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', systemInstruction: '' });
  const [isAdding, setIsAdding] = useState(false);

  const handleAddTemplate = async () => {
    if (!newTemplate.name || !newTemplate.systemInstruction) return;
    const path = 'templates';
    try {
      await addDoc(collection(db, path), {
        ...newTemplate,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      alert("Template saved successfully.");
      setNewTemplate({ name: '', description: '', systemInstruction: '' });
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-emerald-600" />
          Agency Template Manager
        </h2>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all"
        >
          {isAdding ? 'Cancel' : 'Create New Template'}
        </button>
      </div>

      {isAdding && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-200 space-y-4"
        >
          <h3 className="font-bold text-emerald-700">New Agency Template</h3>
          <div className="grid grid-cols-1 gap-4">
            <input 
              type="text" 
              placeholder="Template Name (e.g., Hamilton County Court Format)"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({...newTemplate, name: e.target.value})}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none"
            />
            <input 
              type="text" 
              placeholder="Brief Description"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({...newTemplate, description: e.target.value})}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none"
            />
            <textarea 
              placeholder="System Instructions (The 'brain' of the AI for this template)..."
              value={newTemplate.systemInstruction}
              onChange={(e) => setNewTemplate({...newTemplate, systemInstruction: e.target.value})}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none h-48"
            />
          </div>
          <button 
            onClick={handleAddTemplate}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-100"
          >
            Save Template to Agency Library
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agencyTemplates.map(template => (
          <div key={template.id} className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm hover:border-emerald-200 transition-all group">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-gray-800">{template.name}</h3>
              <span className="text-[10px] bg-gray-100 px-2 py-1 rounded-md text-gray-500 font-bold uppercase">Active</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">{template.description}</p>
            <div className="pt-4 border-t border-gray-50 flex justify-between items-center">
              <span className="text-[10px] text-gray-400">Created {template.createdAt?.toDate() ? new Date(template.createdAt.toDate()).toLocaleDateString() : 'Recent'}</span>
              <button className="text-emerald-600 text-xs font-bold opacity-0 group-hover:opacity-100 transition-all">Edit Template</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

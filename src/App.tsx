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
  LogIn
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
  supervisorMode: boolean;
  outputFormat: OutputFormat;
}

// --- App Component ---

export default function App() {
  const [caseData, setCaseData] = useState<CaseData>({
    reportTitle: '',
    caseNotes: '',
    caseType: 'Investigation',
    childInfo: '',
    supervisorMode: false,
    outputFormat: 'Plain Text',
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
  const [authLoading, setAuthLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  
  const reportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Update user profile in Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            lastLogin: serverTimestamp()
          }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}`);
        }
        
        setUser(firebaseUser);
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Auto-logout timer (15 minutes of inactivity)
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
        supervisorMode: false,
        outputFormat: 'Plain Text',
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
        setCaseData(parsed);
        setHistory([parsed.caseNotes]);
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
      supervisorMode: false,
      outputFormat: 'Plain Text',
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
      const model = ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: constructPrompt(redactedData) }]
          }
        ],
        config: {
          systemInstruction: `You are a Child Welfare AI Assistant, called "Child Welfare Copilot". 
Your role is to help CPS caseworkers and supervisors create accurate, compliant, and structured case documentation, generate court reports, flag risk and missing information, and suggest family support resources.

IMPORTANT PRIVACY NOTICE: The input text has been redacted to protect PII. You will see placeholders like [PERSON_1], [SSN_1], [PHONE_1]. Maintain these placeholders exactly in your output. Do not attempt to guess or hallucinate the original values.

You must always:
1. Use formal, professional language suitable for courts and supervisors.
2. Follow West Virginia / Cabell County CPS reporting standards unless otherwise specified.
3. Include all required sections: Background, Allegations, Investigation Summary, Safety Assessment, Actions Taken, Recommendations.
4. Highlight any missing mandatory information or potential policy compliance issues.
5. Suggest evidence-based family services if requested.`,
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
- Child & Family Info: ${data.childInfo || "Not provided"}
- Supervisor Review Mode: ${data.supervisorMode}
- Requested Output Format: ${data.outputFormat}

INSTRUCTIONS:
${formatInstruction}

AI TASKS / WORKFLOW:
1. Summarize Case Notes: Extract key facts and identify risk indicators.
2. Generate Structured Report: Include Background, Allegations, Investigation Summary, Safety Assessment, Actions Taken, and Recommendations.
3. Supervisor Review / QA: If Supervisor Review Mode is true, highlight missing sections and flag high-risk issues.
4. Family Services Recommendation: Suggest evidence-based programs.
5. Output Formatting: Use clear headings and bullet points.
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Input Section */}
          <div className="lg:col-span-5 space-y-6">
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
                    <div className="absolute bottom-3 right-3 flex items-center gap-3 text-[10px] font-medium text-gray-400 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-md border border-gray-100">
                      <span>{wordCount} Words</span>
                      <span className="w-px h-2 bg-gray-200" />
                      <span>{charCount} Characters</span>
                    </div>
                  </div>
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, 
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area 
} from 'recharts';
import { 
  Home, Users, Target, Calendar, FileText, LogOut, Plus, 
  Search, Filter, Download, X, Edit2, Trash2, Save, ChevronLeft,
  Mail, Phone, Building2, Clock, AlertCircle, CheckCircle2,
  LayoutGrid, List, Menu, User, Bell, TrendingUp, Activity,
  Flame, Sun, Snowflake, FileDown, DollarSign, Send, Eye, Printer, BarChart3,
  Settings, UserPlus, UserMinus, Shield, ListTodo
} from 'lucide-react';

// Add global styles for Light Theme
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow-x: hidden;
      background-color: #f9fafb; /* Light background */
      color: #111827; /* Dark text */
    }

    @media (hover: hover) {
      .mobile-nav-item:not([aria-current='page']):hover {
        background-color: #f9fafb;
        color: #111827;
      }
    }
    
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: #f3f4f6;
    }
    
    ::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: #9ca3af;
    }
  `;
  document.head.appendChild(style);
}

import { useAuth, useClerk, useUser, SignIn } from '@clerk/clerk-react';
import { createApiClient, fetchAllPages } from './src/lib/api-client.js';
import { pageFromPathname, pathForPage } from './src/app/routes.js';
import { AppShell } from './src/components/layout/AppShell.jsx';
import { ConfirmDialog } from './src/components/ui/ConfirmDialog.jsx';
import { EmptyState } from './src/components/ui/EmptyState.jsx';
import SalesWorkspace from './src/features/sales/SalesWorkspace.jsx';
import ProductivityWorkspace from './src/features/productivity/ProductivityWorkspace.jsx';
import RevenueWorkspace from './src/features/revenue/RevenueWorkspace.jsx';
import ReportingWorkspace from './src/features/reporting/ReportingWorkspace.jsx';

let pdfLibrariesPromise;
const loadPdfLibraries = () => {
  pdfLibrariesPromise ??= Promise.all([import('jspdf'), import('jspdf-autotable')])
    .then(([jspdfModule, autoTableModule]) => ({
      jsPDF: jspdfModule.default,
      autoTable: autoTableModule.default,
    }));
  return pdfLibrariesPromise;
};

// Pipeline stages
const PIPELINE_STAGES = [
  { id: 'new', label: 'New Lead', color: '#3B82F6' },
  { id: 'qualified', label: 'Qualified', color: '#8B5CF6' },
  { id: 'follow-up', label: 'Follow-up', color: '#F59E0B' },
  { id: 'proposal', label: 'Proposal', color: '#10B981' },
  { id: 'closed-won', label: 'Closed Won', color: '#059669' },
  { id: 'closed-lost', label: 'Closed Lost', color: '#EF4444' }
];

const exportToCSV = (data, filename) => {
  const headers = ['Name', 'Company', 'Email', 'Phone', 'Source', 'Stage', 'Created', 'Latest Note'];
  const rows = data.map(lead => [
    lead.name,
    lead.company,
    lead.email,
    lead.phone,
    lead.source,
    PIPELINE_STAGES.find(s => s.id === lead.stage)?.label || lead.stage,
    new Date(lead.createdAt).toLocaleDateString(),
    lead.notes?.[0]?.text || ''
  ]);
  
  const csv = [headers, ...rows].map(row =>
    row.map(cell => {
      const raw = String(cell ?? '');
      const formulaSafe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${formulaSafe.replaceAll('"', '""')}"`;
    }).join(',')
  ).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Utility: Calculate Lead Score (0-100)
const calculateLeadScore = (lead) => {
  let score = 0;
  if (lead.email) score += 10;
  if (lead.phone) score += 10;
  if (lead.company) score += 5;
  if (['Referral', 'LinkedIn', 'Partner'].includes(lead.source)) score += 15;
  if (lead.notes) score += (lead.notes.length * 5);
  if (lead.stage === 'qualified') score += 10;
  if (lead.stage === 'proposal') score += 20;
  return Math.min(score, 100);
};

// Utility: Get Score Label & Color
const getScoreConfig = (score) => {
  if (score >= 60) return { label: 'Hot', color: 'text-red-600', bg: 'bg-red-50', icon: Flame };
  if (score >= 30) return { label: 'Warm', color: 'text-orange-500', bg: 'bg-orange-50', icon: Sun };
  return { label: 'Cold', color: 'text-blue-500', bg: 'bg-blue-50', icon: Snowflake };
};

const useModalBehavior = (onClose) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);

  return isMobile;
};

function Toast({ toast, onDismiss }) {
  if (!toast) return null;

  const tone = toast.type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-green-200 bg-green-50 text-green-800';
  const Icon = toast.type === 'error' ? AlertCircle : CheckCircle2;

  return (
    <div className="fixed right-4 top-4 z-[70] w-[min(22rem,calc(100vw-2rem))]" role="status" aria-live="polite">
      <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${tone}`}>
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm font-medium">{toast.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// 1. Google Calendar Link Generator
const generateCalendarUrl = (lead) => {
  const title = encodeURIComponent(`Meeting with ${lead.name}`);
  const details = encodeURIComponent(`Discuss business proposal with ${lead.company}. Phone: ${lead.phone}`);
  const location = encodeURIComponent(lead.company || 'Remote');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(10, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setHours(11, 0, 0, 0);
  const formatTime = (date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${formatTime(startDate)}/${formatTime(endDate)}`;
};

// 2. Smart Email Generator
const generateEmailUrl = (lead) => {
  const subject = encodeURIComponent(`Follow up: ${lead.company || 'Business Opportunity'}`);
  const body = encodeURIComponent(`Hi ${lead.name},\n\nIt was great connecting with you. I wanted to follow up on our conversation regarding...\n\nBest regards,`);
  return `mailto:${lead.email}?subject=${subject}&body=${body}`;
};

// 3. Professional PDF Quote Generator
const generateQuotePDF = async (lead) => {
  const { jsPDF, autoTable } = await loadPdfLibraries();
  const doc = new jsPDF();
  
  // -- CONFIGURATION --
  const companyName = "CRM Pro Inc.";
  const companyAddress = ["123 Business Ave, Suite 100", "Tech City, TC 90210", "support@crmpro.com"];
  const brandColor = [99, 102, 241]; // Your theme color #6366F1
  
  // -- HEADER SECTION --
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...brandColor);
  doc.text(companyName, 14, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  let yPos = 28;
  companyAddress.forEach(line => {
    doc.text(line, 14, yPos);
    yPos += 5;
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(200); 
  doc.text("QUOTE", 150, 25);
  
  doc.setFontSize(10);
  doc.setTextColor(0); 
  doc.text(`Quote #: Q-${Math.floor(Math.random() * 10000)}`, 150, 35);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 40);
  
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 14);
  doc.text(`Valid Until: ${expiryDate.toLocaleDateString()}`, 150, 45);

  doc.setDrawColor(230);
  doc.line(14, 50, 196, 50);

  // -- CLIENT SECTION --
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("Bill To:", 14, 60);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(50);
  doc.text(lead.name, 14, 66);
  doc.text(lead.company || '', 14, 71);
  doc.text(lead.email, 14, 76);
  if (lead.phone) doc.text(lead.phone, 14, 81);

  // -- ITEMS TABLE --
  const items = lead.quoteItems || [];
  
  const tableColumn = ["Description", "Quantity", "Price", "Amount"];
  const tableRows = items.map(item => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.price) || 0;
    const total = qty * price;
    return [
      item.description || "Service",
      qty.toString(),
      `$${price.toFixed(2)}`,
      `$${total.toFixed(2)}`
    ];
  });

  autoTable(doc, {
    startY: 90,
    head: [tableColumn],
    body: tableRows,
    theme: 'plain', 
    headStyles: {
      fillColor: brandColor,
      textColor: 255,
      fontSize: 10,
      fontStyle: 'bold',
      halign: 'left',
      cellPadding: 3
    },
    bodyStyles: {
      textColor: 50,
      fontSize: 10,
      cellPadding: 3
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: 'center' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' }
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251]
    },
    margin: { top: 90 }
  });

  // -- TOTALS SECTION --
  const finalY = doc.lastAutoTable.finalY + 10;
  const grandTotal = items.reduce((sum, item) => {
    return sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0));
  }, 0);

  doc.setFont("helvetica", "normal");
  doc.text("Subtotal:", 140, finalY);
  doc.text(`$${grandTotal.toFixed(2)}`, 196, finalY, { align: "right" });

  doc.text("Tax (0%):", 140, finalY + 7);
  doc.text("$0.00", 196, finalY + 7, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...brandColor);
  doc.text("Total:", 140, finalY + 16);
  doc.text(`$${grandTotal.toFixed(2)}`, 196, finalY + 16, { align: "right" });

  // -- FOOTER SECTION --
  const pageHeight = doc.internal.pageSize.height;
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text("Terms & Conditions", 14, pageHeight - 40);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  const terms = [
    "1. Payment is due within 14 days of invoice date.",
    "2. Please make checks payable to CRM Pro Inc.",
    "3. Questions? Contact support@crmpro.com"
  ];
  let termY = pageHeight - 35;
  terms.forEach(term => {
    doc.text(term, 14, termY);
    termY += 4;
  });

  doc.setDrawColor(brandColor[0], brandColor[1], brandColor[2]);
  doc.setLineWidth(1);
  doc.line(14, pageHeight - 15, 196, pageHeight - 15);
  
  const text = "Thank you for your business!";
  const textWidth = doc.getStringUnitWidth(text) * doc.internal.getFontSize() / doc.internal.scaleFactor;
  const x = (doc.internal.pageSize.width - textWidth) / 2;
  doc.setFontSize(9);
  doc.setTextColor(brandColor[0], brandColor[1], brandColor[2]);
  doc.text(text, x, pageHeight - 8);

  const safeLeadName = lead.name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  doc.save(`Quote_Q-${Math.floor(Math.random() * 10000)}_${safeLeadName}.pdf`);
};

// Main App Component
export default function CRMApp() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);

  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const api = useMemo(() => createApiClient(getToken, { workspaceId: activeWorkspaceId }), [getToken, activeWorkspaceId]);
  const fetchApi = api.request;

  const currentPage = pageFromPathname(location.pathname);
  const isMobile = useIsMobile();
  // Keep the desktop sidebar expanded, but never show the mobile drawer until
  // the user explicitly opens it from the header menu.
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window === 'undefined' || !window.matchMedia('(max-width: 1023px)').matches
  ));

  useEffect(() => {
    // Moving from a desktop viewport to mobile should not leave the drawer open.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  
  // Data states
  const [leads, setLeads] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [activities, setActivities] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customerRecords, setCustomerRecords] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [dashboardTrendRange, setDashboardTrendRange] = useState('7');
  
  // UI states
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [pipelineView, setPipelineView] = useState('kanban'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [filterStage, setFilterStage] = useState('all');
  const [dataLoadErrors, setDataLoadErrors] = useState([]);
  const [toast, setToast] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [receivedInvitations, setReceivedInvitations] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolverRef = useRef(null);

  const notify = (message, type = 'success') => {
    setToast({ message, type });
  };

  const runGlobalSearch = useCallback(async query => {
    if (!query || query.trim().length < 2) {
      setGlobalSearchResults([]);
      return;
    }
    setGlobalSearchLoading(true);
    try {
      const results = await fetchApi(`/search?q=${encodeURIComponent(query.trim())}&limit=10`);
      setGlobalSearchResults(Array.isArray(results) ? results : []);
    } catch (error) {
      console.error('Global search failed:', error);
      setGlobalSearchResults([]);
    } finally {
      setGlobalSearchLoading(false);
    }
  }, [fetchApi]);

  const requestConfirm = useCallback((options) => new Promise(resolve => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = resolve;
    setConfirmDialog(options);
  }), []);

  const resolveConfirm = useCallback((accepted) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolve?.(accepted);
  }, []);

  const invalidateDashboard = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['dashboard', activeWorkspaceId || 'default'],
    });
  }, [activeWorkspaceId, queryClient]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 1. Auth & Initial Data Load
  useEffect(() => {
    if (isLoaded) {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (user) {
      fetchData(user.id);
    }
  }, [user, activeWorkspaceId]);

  const customers = useMemo(() => {
    const persisted = customerRecords.map(customer => ({ ...customer, isCustomer: true }));
    const customerEmails = new Set(persisted.map(customer => customer.email.toLowerCase()));
    const leadCustomers = leads
      .filter(lead => !customerEmails.has(lead.email.toLowerCase()))
      .map(lead => ({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        isCustomer: false,
      }));
    return [...persisted, ...leadCustomers];
  }, [customerRecords, leads]);

  // 2. Fetch Data Helper (With Data Mapping)
  const fetchData = async (userId) => {
    setLoading(true);
    try {
      const resources = ['leads', 'meetings', 'activities', 'invoices', 'customers', 'accounts', 'contacts', 'deals', 'pipelines'];
      const results = await Promise.allSettled([
        fetchAllPages(api, '/leads'),
        fetchAllPages(api, '/meetings'),
        fetchAllPages(api, '/activities'),
        fetchAllPages(api, '/invoices'),
        fetchAllPages(api, '/customers'),
        fetchAllPages(api, '/accounts'),
        fetchAllPages(api, '/contacts'),
        fetchAllPages(api, '/deals'),
        fetchAllPages(api, '/pipelines'),
      ]);
      const failures = results
        .map((result, index) => result.status === 'rejected'
          ? { resource: resources[index], message: result.reason?.message || 'Request failed' }
          : null)
        .filter(Boolean);
      setDataLoadErrors(failures);
      failures.forEach(failure => console.error(`Error fetching ${failure.resource}:`, failure.message));

      const [leadsResult, meetingsResult, activitiesResult, invoicesResult, customersResult, accountsResult, contactsResult, dealsResult, pipelinesResult] = results;
      const leadsRes = leadsResult.status === 'fulfilled' ? leadsResult.value : null;
      const meetingsRes = meetingsResult.status === 'fulfilled' ? meetingsResult.value : null;
      const activitiesRes = activitiesResult.status === 'fulfilled' ? activitiesResult.value : null;
      const invoiceRows = invoicesResult.status === 'fulfilled' ? invoicesResult.value : null;
      const customerRows = customersResult.status === 'fulfilled' ? customersResult.value : null;
      const accountRows = accountsResult.status === 'fulfilled' ? accountsResult.value : null;
      const contactRows = contactsResult.status === 'fulfilled' ? contactsResult.value : null;
      const dealRows = dealsResult.status === 'fulfilled' ? dealsResult.value : null;
      const pipelineRows = pipelinesResult.status === 'fulfilled' ? pipelinesResult.value : null;

      if (leadsRes) {
        const mappedLeads = leadsRes.map(l => ({
          ...l,
          createdAt: l.created_at,
          quoteItems: l.quote_items || []
        }));
        setLeads(mappedLeads);
      }

      if (meetingsRes) {
        const mappedMeetings = meetingsRes.map(m => ({
          ...m,
          dateTime: m.date_time,
          leadId: m.lead_id,
          createdAt: m.created_at
        }));
        setMeetings(mappedMeetings);
      }

      if (activitiesRes) setActivities(activitiesRes);
      if (invoiceRows) setInvoices(invoiceRows);
      if (customerRows) setCustomerRecords(customerRows);
      if (accountRows) setAccounts(accountRows);
      if (contactRows) setContacts(contactRows);
      if (dealRows) setDeals(dealRows);
      if (pipelineRows) setPipelines(pipelineRows);
    } catch (error) {
      console.error('Error fetching data:', error);
      notify('We could not load your CRM data. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', activeWorkspaceId || 'default', dashboardTrendRange],
    queryFn: () => fetchApi(`/dashboard?trendDays=${dashboardTrendRange}`),
    enabled: Boolean(user && currentPage === 'dashboard'),
    staleTime: 30_000,
  });

  const dashboardData = dashboardQuery.data ?? null;

  useEffect(() => {
    if (dashboardQuery.error) {
      console.error('Error loading dashboard aggregates:', dashboardQuery.error);
    }
  }, [dashboardQuery.error]);

  const refreshTeam = async () => {
    try {
      const [team, invitations] = await Promise.all([
        fetchApi('/team'),
        fetchApi('/team?view=invitations'),
      ]);
      setTeamData(team);
      setReceivedInvitations(invitations?.invitations || []);
    } catch (error) {
      console.error('Error loading team settings:', error);
    }
  };

  useEffect(() => {
    if (user) void refreshTeam();
  }, [user, activeWorkspaceId]);

  const manageTeam = async (body) => {
    try {
      const result = await fetchApi('/team', { method: 'POST', body });
      await refreshTeam();
      return result;
    } catch (error) {
      notify(error.message || 'Unable to update the team.', 'error');
      throw error;
    }
  };

  // Fetch customers
  const fetchCustomers = async () => {
    try {
      const customersData = await fetchAllPages(api, '/customers');
      setCustomerRecords(customersData || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  // Create customer record from lead if it doesn't exist
  const ensureCustomerExists = async (selectedId) => {
    // Find the selected item in our customers list
    const selectedItem = customers.find(c => c.id === selectedId);
    
    if (!selectedItem) {
      throw new Error('Selected customer not found');
    }

    // If it's already a customer, return the ID
    if (selectedItem.isCustomer) {
      return selectedId;
    }

    // It's a lead, so create a customer record
    let newCustomer;
    let error = null;
    try {
      newCustomer = await fetchApi('/customers', { method: 'POST', body: {
        name: selectedItem.name,
        email: selectedItem.email,
        phone: selectedItem.phone,
        company: selectedItem.company
      } });
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error('Error creating customer from lead:', error);
      throw new Error(`Failed to create customer: ${error.message}`);
    }

    // Refresh customers list
    await fetchCustomers();
    
    return newCustomer.id;
  };

 // --- CRUD OPERATIONS ---

  // Add Activity
  const addActivity = async (type, message, leadId = null) => {
    const newActivity = {
      type,
      message,
      lead_id: leadId
    };
    
    let data; let error = null; try { data = await fetchApi('/activities', { method: 'POST', body: newActivity }); } catch (e) { error = e; }
    
    if (error) {
      console.error('Error adding activity:', error);
      return;
    }

    if (data) {
      setActivities(prev => [data, ...prev]);
    }
  };

  // 3. Lead Operations
  const addLead = async (leadData) => {
    const { quoteItems, ...rest } = leadData;
    const dbLead = {
      ...rest,
      stage: leadData.stage || 'new',
      quote_items: quoteItems || [],
      notes: [],
      reminders: []
    };

    let data; let error = null; try { data = await fetchApi('/leads', { method: 'POST', body: dbLead }); } catch (e) { error = e; }

    if (error) {
      console.error('Error adding lead:', error);
      notify(error.message || 'Failed to add lead.', 'error');
      return;
    }

    if (data) {
      const newLead = {
        ...data,
        createdAt: data.created_at,
        quoteItems: data.quote_items
      };
      setLeads(prev => [newLead, ...prev]);
      invalidateDashboard();
      addActivity('lead_created', `New lead added: ${leadData.name}`);
      notify('Lead created successfully.');
    }
  };

  const updateLead = async (leadId, updates) => {
    const dbUpdates = { ...updates };
    if (updates.quoteItems) {
      dbUpdates.quote_items = updates.quoteItems;
      delete dbUpdates.quoteItems;
    }

    let data; let error = null; try { data = await fetchApi(`/leads?id=${ leadId }`, { method: 'PUT', body: dbUpdates }); } catch (e) { error = e; }

    if (error) {
      console.error('Error updating lead:', error);
      notify(error.message || 'Failed to update lead.', 'error');
      return;
    }

    if (data) {
      setLeads(prev => prev.map(lead => 
        lead.id === leadId ? { ...lead, ...updates, quoteItems: data.quote_items } : lead
      ));
      invalidateDashboard();
      addActivity('lead_updated', `Lead updated`, leadId);
      notify('Lead updated successfully.');
    }
  };

  const deleteLead = async (leadId) => {
    const previousLeads = leads;
    setLeads(prev => prev.filter(l => l.id !== leadId));
    
    let error = null; try { await fetchApi(`/leads?id=${ leadId }`, { method: 'DELETE' }); } catch (e) { error = e; }
    
    if (error) {
      console.error('Error deleting lead:', error);
      setLeads(previousLeads);
      notify(error.message || 'Failed to delete lead.', 'error');
    } else {
      invalidateDashboard();
      addActivity('lead_deleted', 'Lead deleted');
      notify('Lead deleted.');
    }
  };

  const bulkUpdateLeads = async (leadIds, stage) => {
    try {
      await fetchApi('/leads/bulk', {
        method: 'POST',
        body: { action: 'update', ids: leadIds, updates: { stage } },
      });
      setLeads(prev => prev.map(lead => leadIds.includes(lead.id) ? { ...lead, stage } : lead));
      invalidateDashboard();
      addActivity('leads_bulk_updated', `${leadIds.length} leads moved to ${PIPELINE_STAGES.find(item => item.id === stage)?.label || stage}`);
      notify(`${leadIds.length} lead${leadIds.length === 1 ? '' : 's'} updated.`);
    } catch (error) {
      console.error('Error updating leads in bulk:', error);
      notify(error.message || 'Some leads could not be updated.', 'error');
    }
  };

  const bulkDeleteLeads = async (leadIds) => {
    const previousLeads = leads;
    setLeads(prev => prev.filter(lead => !leadIds.includes(lead.id)));
    try {
      await fetchApi('/leads/bulk', {
        method: 'POST',
        body: { action: 'delete', ids: leadIds },
      });
      invalidateDashboard();
      addActivity('leads_bulk_deleted', `${leadIds.length} leads deleted`);
      notify(`${leadIds.length} lead${leadIds.length === 1 ? '' : 's'} deleted.`);
    } catch (error) {
      console.error('Error deleting leads in bulk:', error);
      setLeads(previousLeads);
      notify(error.message || 'Some leads could not be deleted.', 'error');
    }
  };

  const createAccount = async input => {
    try {
      const data = await fetchApi('/accounts', { method: 'POST', body: input });
      setAccounts(prev => [data, ...prev]);
      notify('Account created.');
      return data;
    } catch (error) {
      notify(error.message || 'The account could not be created.', 'error');
      throw error;
    }
  };

  const updateAccount = async (accountId, input) => {
    try {
      const data = await fetchApi(`/accounts?id=${accountId}`, { method: 'PUT', body: input });
      setAccounts(prev => prev.map(account => account.id === accountId ? data : account));
      notify('Account updated.');
      return data;
    } catch (error) {
      notify(error.message || 'The account could not be updated.', 'error');
      throw error;
    }
  };

  const createContact = async input => {
    try {
      const data = await fetchApi('/contacts', { method: 'POST', body: input });
      setContacts(prev => [data, ...prev]);
      notify('Contact created.');
      return data;
    } catch (error) {
      notify(error.message || 'The contact could not be created.', 'error');
      throw error;
    }
  };

  const updateContact = async (contactId, input) => {
    try {
      const data = await fetchApi(`/contacts?id=${contactId}`, { method: 'PUT', body: input });
      setContacts(prev => prev.map(contact => contact.id === contactId ? data : contact));
      notify('Contact updated.');
      return data;
    } catch (error) {
      notify(error.message || 'The contact could not be updated.', 'error');
      throw error;
    }
  };

  const createDeal = async input => {
    try {
      const data = await fetchApi('/deals', { method: 'POST', body: input });
      setDeals(prev => [data, ...prev]);
      invalidateDashboard();
      notify('Deal created.');
      return data;
    } catch (error) {
      notify(error.message || 'The deal could not be created.', 'error');
      throw error;
    }
  };

  const updateDeal = async (dealId, input) => {
    try {
      const data = await fetchApi(`/deals?id=${dealId}`, { method: 'PUT', body: input });
      setDeals(prev => prev.map(deal => deal.id === dealId ? data : deal));
      invalidateDashboard();
      return data;
    } catch (error) {
      notify(error.message || 'The deal could not be updated.', 'error');
      throw error;
    }
  };

  const convertLeadToDeal = async lead => {
    try {
      const result = await fetchApi('/leads/convert', { method: 'POST', body: { lead_id: lead.id }, includeMeta: true });
      const data = result.data;
      setDeals(prev => [data, ...prev.filter(deal => deal.id !== data.id)]);
      invalidateDashboard();
      notify(result.converted === false ? 'This lead already has a deal.' : 'Lead converted to a deal.');
      navigate(pathForPage('deals'));
      return data;
    } catch (error) {
      notify(error.message || 'The lead could not be converted.', 'error');
      throw error;
    }
  };

  const addNote = async (leadId, noteText) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    try {
      const savedNote = await fetchApi('/notes', {
        method: 'POST',
        body: { lead_id: leadId, body: noteText },
      });
      const newNote = {
        id: savedNote.id,
        text: savedNote.body,
        timestamp: savedNote.created_at,
      };
      setLeads(prev => prev.map(item => item.id === leadId
        ? { ...item, notes: [newNote, ...(item.notes || [])] }
        : item));
      setSelectedLead(prev => prev?.id === leadId
        ? { ...prev, notes: [newNote, ...(prev.notes || [])] }
        : prev);
      invalidateDashboard();
    } catch (error) {
      console.error('Error adding note:', error);
      notify(error.message || 'The note could not be saved.', 'error');
    }
  };

  const addReminder = async (leadId, reminderData) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    try {
      const savedActivity = await fetchApi('/activities', {
        method: 'POST',
        body: {
          type: 'task',
          subject: reminderData.note,
          description: reminderData.note,
          lead_id: leadId,
          due_at: new Date(`${reminderData.date}T09:00:00`).toISOString(),
        },
      });
      const newReminder = {
        id: savedActivity.id,
        date: reminderData.date,
        note: savedActivity.subject,
        createdAt: savedActivity.created_at,
        completed: Boolean(savedActivity.completed_at),
      };
      setLeads(prev => prev.map(item => item.id === leadId
        ? { ...item, reminders: [...(item.reminders || []), newReminder] }
        : item));
      setActivities(previous => [savedActivity, ...previous]);
      setSelectedLead(prev => prev?.id === leadId
        ? { ...prev, reminders: [...(prev.reminders || []), newReminder] }
        : prev);
      invalidateDashboard();
    } catch (error) {
      console.error('Error adding reminder:', error);
      notify(error.message || 'The reminder could not be saved.', 'error');
    }
  };

  const completeReminder = async (leadId, reminderId) => {
    const lead = leads.find(item => item.id === leadId);
    if (!lead) return;
    let activity = activities.find(item => (
      (item.id === reminderId || item.legacy_source_id === reminderId) && item.lead_id === leadId
    ));
    if (!activity) {
      try {
        const relatedActivities = await fetchApi(`/activities?lead_id=${leadId}&bucket=all&pageSize=100`);
        activity = relatedActivities.find(item => item.id === reminderId || item.legacy_source_id === reminderId);
      } catch (error) {
        console.error('Error loading reminder activity:', error);
      }
    }
    if (!activity) {
      notify('This reminder is not available as an activity. Refresh the page and try again.', 'error');
      return;
    }

    try {
      await fetchApi(`/activities?id=${activity.id}`, {
        method: 'PUT',
        body: { completed: true },
      });
      const completedAt = new Date().toISOString();
      const updatedReminders = (lead.reminders || []).map(reminder => (
        reminder.id === reminderId ? { ...reminder, completed: true, completedAt } : reminder
      ));
      setActivities(previous => previous.map(item => item.id === activity.id
        ? { ...item, completed: true, completed_at: completedAt }
        : item));
      setLeads(prev => prev.map(item => item.id === leadId ? { ...item, reminders: updatedReminders } : item));
      setSelectedLead(prev => prev?.id === leadId ? { ...prev, reminders: updatedReminders } : prev);
      invalidateDashboard();
      notify('Follow-up marked complete.');
    } catch (error) {
      notify(error.message || 'Failed to complete follow-up.', 'error');
    }
  };

  // 4. Meeting Operations
  const addMeeting = async (meetingData) => {
    const dbMeeting = {
      lead_id: meetingData.leadId,
      title: meetingData.title,
      date_time: meetingData.dateTime,
      notes: meetingData.notes
    };

    let data; let error = null; try { data = await fetchApi('/meetings', { method: 'POST', body: dbMeeting }); } catch (e) { error = e; }

    if (error) {
      console.error('Error adding meeting:', error);
      notify(error.message || 'Failed to schedule meeting.', 'error');
      return;
    }

    if (data) {
      const newMeeting = {
        ...data,
        dateTime: data.date_time,
        leadId: data.lead_id,
        createdAt: data.created_at
      };
      setMeetings(prev => [newMeeting, ...prev]);
      invalidateDashboard();
      addActivity('meeting_scheduled', `Meeting scheduled: ${meetingData.title}`, meetingData.leadId);
      notify('Meeting scheduled successfully.');
    }
  };

  const updateMeeting = async (meetingId, updates) => {
    const dbUpdates = { ...updates };
    if (updates.dateTime) {
      dbUpdates.date_time = updates.dateTime;
      delete dbUpdates.dateTime;
    }
    
    let data; let error = null; try { data = await fetchApi(`/meetings?id=${ meetingId }`, { method: 'PUT', body: dbUpdates }); } catch (e) { error = e; }
    
    if (error) {
      console.error('Error updating meeting:', error);
      notify(error.message || 'Failed to update meeting.', 'error');
    } else {
      setMeetings(prev => prev.map(meeting =>
        meeting.id === meetingId ? {
          ...data,
          dateTime: data.date_time,
          leadId: data.lead_id,
          createdAt: data.created_at,
        } : meeting
      ));
      invalidateDashboard();
      addActivity('meeting_updated', `Meeting updated`, updates.leadId);
      notify('Meeting updated successfully.');
    }
  };

  const deleteMeeting = async (meetingId) => {
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
    let error = null; try { await fetchApi(`/meetings?id=${ meetingId }`, { method: 'DELETE' }); } catch (e) { error = e; }
    if (error) {
      console.error('Error deleting meeting:', error);
      notify(error.message || 'Failed to delete meeting.', 'error');
    } else {
      invalidateDashboard();
      addActivity('meeting_deleted', `Meeting deleted`);
      notify('Meeting deleted.');
    }
  };

  // Invoice Operations
  const addInvoice = async (invoiceData) => {
    try {
      // First, ensure the customer exists in the customers table
      const validCustomerId = await ensureCustomerExists(invoiceData.customer_id);
      
      const newInvoice = {
        ...invoiceData,
        customer_id: validCustomerId
      };

      let data;
      let error = null;
      try {
        data = await fetchApi('/invoices', { method: 'POST', body: newInvoice });
      } catch (e) {
        error = e;
      }

      if (error) {
        console.error('Error creating invoice:', error);
        notify(`Failed to create invoice: ${error.message || 'Unknown error'}`, 'error');
        return;
      }

      if (data) {
        setInvoices(prev => [data, ...prev]);
        invalidateDashboard();
        setShowInvoiceModal(false);
        setSelectedInvoice(null);
        addActivity('invoice_created', `Invoice ${data.invoice_number} created`);
        notify('Invoice created successfully.');
      }
    } catch (err) {
      console.error('Exception creating invoice:', err);
      notify(`Failed to create invoice: ${err.message}`, 'error');
    }
  };

  const updateInvoice = async (invoiceId, invoiceData) => {
    let data;
    let error = null;
    try {
      data = await fetchApi(`/invoices?id=${invoiceId}`, { method: 'PUT', body: invoiceData });
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error('Error updating invoice:', error);
      notify('Failed to update invoice.', 'error');
      return;
    }

    if (data) {
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? data : inv));
      invalidateDashboard();
      setShowInvoiceModal(false);
      setSelectedInvoice(null);
      addActivity('invoice_updated', `Invoice ${data.invoice_number} updated`);
      notify('Invoice updated successfully.');
    }
  };

  const deleteInvoice = async (invoiceId) => {
    const invoice = invoices.find(i => i.id === invoiceId);
    let error = null;
    try {
      await fetchApi(`/invoices?id=${invoiceId}`, { method: 'DELETE' });
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error('Error deleting invoice:', error);
      notify(error.message || 'Failed to delete invoice.', 'error');
      return;
    }

    setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
    invalidateDashboard();
    addActivity('invoice_deleted', `Invoice ${invoice?.invoice_number} deleted`);
    notify('Invoice deleted.');
  };

  // Drag and drop handler
  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;
    
    if (source.droppableId !== destination.droppableId) {
      const lead = leads.find(l => l.id === draggableId);
      
      // Optimistic update
      setLeads(prev => prev.map(l => 
        l.id === draggableId ? { ...l, stage: destination.droppableId } : l
      ));

      // DB update
      try {
        await fetchApi(`/leads?id=${ draggableId }`, { method: 'PUT', body: { stage: destination.droppableId } });
        addActivity('stage_changed', `${lead?.name} moved to ${PIPELINE_STAGES.find(s => s.id === destination.droppableId)?.label}`, draggableId);
      } catch (error) {
        setLeads(prev => prev.map(item => item.id === draggableId ? lead : item));
        notify(error.message || 'Failed to move lead.', 'error');
      }
      if (!lead) {
        notify('That lead is no longer available.', 'error');
      }
    }
  };

  // Filter and search leads
  const filteredLeads = leads.filter(lead => {
    const matchesSearch = !searchTerm || 
      lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterStage === 'all' || lead.stage === filterStage;
    
    return matchesSearch && matchesFilter;
  });

  // Get clients (closed-won leads)
  const clients = leads.filter(lead => lead.stage === 'closed-won');

  // Calculate dashboard stats
  const stats = {
    totalLeads: dashboardData?.leads?.total ?? leads.length,
    newLeads: dashboardData?.leads?.newThisMonth ?? leads.filter(lead => {
      const created = new Date(lead.createdAt);
      const now = new Date();
      return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
    }).length,
    qualified: dashboardData?.leads?.qualified ?? leads.filter(l => l.stage === 'qualified').length,
    proposals: dashboardData?.leads?.proposals ?? leads.filter(l => l.stage === 'proposal').length,
    closedWon: dashboardData?.leads?.closedWon ?? leads.filter(l => l.stage === 'closed-won').length,
    upcomingMeetings: dashboardData?.meetings?.upcoming ?? meetings.filter(m => new Date(m.dateTime).getTime() > new Date().getTime()).length,
    overdueReminders: dashboardData?.reminders?.overdue ?? leads.reduce((count, lead) => {
      return count + (lead.reminders || []).filter(r =>
        new Date(r.date) < new Date() && !r.completed
      ).length;
    }, 0)
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 md:p-8" aria-busy="true" aria-label="Loading CRM">
        <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
          <div className="h-10 w-56 rounded-lg bg-gray-200" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(item => <div key={item} className="h-32 rounded-2xl bg-white shadow-sm" />)}
          </div>
          <div className="h-72 rounded-2xl bg-white shadow-sm" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 via-white to-gray-100">
        <SignIn routing="hash" />
      </div>
    );
  }

  const navigateTo = (page) => {
    navigate(pathForPage(page));
    if (isMobile) setSidebarOpen(false);
  };

  return (
    <AppShell
      sidebar={(
        <Sidebar
          open={sidebarOpen}
          mobile={isMobile}
          currentPage={currentPage}
          onNavigate={navigateTo}
          workspaces={teamData?.workspaces || []}
          activeWorkspaceId={activeWorkspaceId || teamData?.workspace?.id}
          onSelectWorkspace={(workspaceId) => {
            setActiveWorkspaceId(workspaceId);
            if (isMobile) setSidebarOpen(false);
          }}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSignOut={signOut}
        />
      )}
      sidebarOverlay={isMobile && sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-gray-950/40 lg:hidden"
        />
      ) : null}
      header={(
        <Header
          user={user}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          overdueCount={stats.overdueReminders}
          workspaceName={teamData?.workspace?.name}
          workspaces={teamData?.workspaces || []}
          activeWorkspaceId={activeWorkspaceId || teamData?.workspace?.id}
          onSelectWorkspace={setActiveWorkspaceId}
          onGlobalSearch={runGlobalSearch}
          globalSearchResults={globalSearchResults}
          globalSearchLoading={globalSearchLoading}
          onGlobalResultClick={(result) => {
            setGlobalSearchResults([]);
            navigate(result.route || '/dashboard');
          }}
        />
      )}
      mobileNav={(
        <MobileBottomNav
          currentPage={currentPage}
          onNavigate={navigateTo}
          onOpenMenu={() => setSidebarOpen(true)}
        />
      )}
    >
          {dataLoadErrors.length > 0 && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Some CRM data could not be loaded.</p>
                <p className="mt-1 text-sm">
                  Failed sections: {dataLoadErrors.map(error => error.resource).join(', ')}. You can retry now or check the matching Vercel function log if the issue continues.
                </p>
                <button
                  type="button"
                  onClick={() => user && fetchData(user.id)}
                  className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  Retry loading
                </button>
              </div>
            </div>
          )}
          <AnimatePresence mode="wait">
            {['dashboard', 'leads', 'contacts', 'accounts', 'deals', 'pipeline'].includes(currentPage) && (
              <SalesWorkspace
                page={currentPage}
                loading={loading}
                error={dataLoadErrors.filter(item => ['leads', 'accounts', 'contacts', 'deals', 'pipelines'].includes(item.resource)).map(item => `${item.resource}: ${item.message}`).join(' ') || null}
                summary={dashboardData}
                leads={leads}
                accounts={accounts}
                contacts={contacts}
                deals={deals}
                pipelines={pipelines}
                activities={activities}
                meetings={meetings}
                onNavigate={navigateTo}
                onAddLead={() => setShowLeadModal(true)}
                onEditLead={(lead) => {
                  setSelectedLead(lead);
                  setShowLeadModal(true);
                }}
                onViewLead={lead => setSelectedLead(lead)}
                onConvertLead={convertLeadToDeal}
                onCreateDeal={createDeal}
                onUpdateDeal={updateDeal}
                onCreateAccount={createAccount}
                onUpdateAccount={updateAccount}
                onCreateContact={createContact}
                onUpdateContact={updateContact}
                onNotify={notify}
              />
            )}

            {currentPage === 'activities' && (
              <ProductivityWorkspace
                request={fetchApi}
                leads={leads}
                accounts={accounts}
                contacts={contacts}
                deals={deals}
                onNotify={notify}
              />
            )}
            
            {currentPage === 'meetings' && (
              <MeetingsPage 
                meetings={meetings}
                leads={leads}
                onAddMeeting={() => {
                  setSelectedMeeting(null);
                  setShowMeetingModal(true);
                }}
                onEditMeeting={(meeting) => {
                  setSelectedMeeting(meeting);
                  setShowMeetingModal(true);
                }}
                onDeleteMeeting={deleteMeeting}
                onRequestConfirm={requestConfirm}
              />
            )}

            {['quotes', 'invoices', 'payments', 'financial-settings'].includes(currentPage) && (
              <RevenueWorkspace
                page={currentPage}
                request={fetchApi}
                deals={deals}
                customers={customers}
                onNavigate={navigateTo}
                onNotify={notify}
              />
            )}

            {currentPage === 'reports' && (
              <ReportingWorkspace
                request={fetchApi}
                pipelines={pipelines}
                members={teamData?.members || []}
                onNotify={notify}
              />
            )}

            {currentPage === 'team' && (
              <TeamSettingsPage
                user={user}
                teamData={teamData}
                receivedInvitations={receivedInvitations}
                activeWorkspaceId={activeWorkspaceId || teamData?.workspace?.id}
                onSelectWorkspace={setActiveWorkspaceId}
                onInvite={(email, role) => manageTeam({ action: 'invite', email, role })}
                onRename={(name) => manageTeam({ action: 'rename', name })}
                onChangeRole={(userId, role) => manageTeam({ action: 'role', userId, role })}
                onRemove={(userId) => manageTeam({ action: 'remove', userId })}
                onRevoke={(invitationId) => manageTeam({ action: 'revoke', invitationId })}
                onAccept={async (invitationId) => {
                  const result = await manageTeam({ action: 'accept', invitationId });
                  setActiveWorkspaceId(result.workspaceId);
                }}
              />
            )}
          </AnimatePresence>
      {/* Modals */}
      {showLeadModal && (
        <LeadModal 
          lead={selectedLead}
          onClose={() => {
            setShowLeadModal(false);
            setSelectedLead(null);
          }}
          onSave={(data) => {
            if (selectedLead) {
              updateLead(selectedLead.id, data);
            } else {
              addLead(data);
            }
            setShowLeadModal(false);
            setSelectedLead(null);
          }}
          onAddNote={addNote}
          onAddReminder={addReminder}
          onCompleteReminder={completeReminder}
        />
      )}

      {selectedLead && !showLeadModal && (
        <LeadDetailDrawer
          lead={selectedLead}
          activities={activities}
          onClose={() => setSelectedLead(null)}
          onEdit={() => setShowLeadModal(true)}
        />
      )}

      {showMeetingModal && (
        <MeetingModal 
          meeting={selectedMeeting}
          leads={leads}
          onClose={() => {
            setShowMeetingModal(false);
            setSelectedMeeting(null);
          }}
          onSave={(data) => {
            if (selectedMeeting) {
              updateMeeting(selectedMeeting.id, data);
            } else {
              addMeeting(data);
            }
            setShowMeetingModal(false);
            setSelectedMeeting(null);
          }}
        />
      )}

      {showInvoiceModal && (
        <InvoiceModal 
          invoice={selectedInvoice}
          customers={customers}
          onClose={() => {
            setShowInvoiceModal(false);
            setSelectedInvoice(null);
          }}
          onSave={(data) => {
            if (selectedInvoice) {
              updateInvoice(selectedInvoice.id, data);
            } else {
              addInvoice(data);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}


// Sidebar Component
function Sidebar({ open, mobile, currentPage, onNavigate, onSignOut, workspaces, activeWorkspaceId, onSelectWorkspace }) {
  const sections = [
    { label: 'Workspace', items: [{ id: 'dashboard', icon: Home, label: 'Dashboard' }] },
    { label: 'Productivity', items: [{ id: 'activities', icon: ListTodo, label: 'My Day' }] },
    { label: 'Sales', items: [
      { id: 'leads', icon: Users, label: 'Leads' },
      { id: 'contacts', icon: User, label: 'Contacts' },
      { id: 'accounts', icon: Building2, label: 'Accounts' },
      { id: 'deals', icon: Target, label: 'Deals' },
      { id: 'pipeline', icon: Activity, label: 'Pipeline' },
    ] },
    { label: 'Operations', items: [
      { id: 'reports', icon: BarChart3, label: 'Reports' },
      { id: 'quotes', icon: FileText, label: 'Quotes' },
      { id: 'invoices', icon: FileText, label: 'Invoices' },
      { id: 'payments', icon: FileText, label: 'Payments' },
      { id: 'financial-settings', icon: Settings, label: 'Financial settings' },
      { id: 'meetings', icon: Calendar, label: 'Meetings' },
    ] },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 280 : 80, x: mobile && !open ? -300 : 0 }}
      className="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 bg-white shadow-xl lg:relative lg:z-10 lg:shadow-none"
    >
      <div className="p-6 border-b border-gray-200">
        <motion.div 
          className="flex items-center gap-3"
          animate={{ justifyContent: open ? 'flex-start' : 'center' }}
        >
          <div className="w-10 h-10 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-xl flex items-center justify-center flex-shrink-0">
            <Target className="w-6 h-6 text-white" />
          </div>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h1 className="text-xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent">
                CRM Pro
              </h1>
            </motion.div>
          )}
        </motion.div>
      </div>

      {mobile && open && workspaces.length > 0 && (
        <div className="border-b border-gray-200 px-6 py-4 lg:hidden">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500" htmlFor="mobile-workspace-selector">Workspace</label>
          <select id="mobile-workspace-selector" value={activeWorkspaceId || ''} onChange={(event) => onSelectWorkspace(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800">
            {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </div>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto p-4">
        {sections.map(section => (
          <div key={section.label}>
            {open && <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">{section.label}</p>}
            <div className="space-y-1">
              {section.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  aria-label={open ? undefined : item.label}
                  title={open ? undefined : item.label}
                  className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 font-medium transition-all ${
                    currentPage === item.id
                      ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/30'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {open && <span>{item.label}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mb-[calc(4.5rem+env(safe-area-inset-bottom))] shrink-0 border-t border-gray-200 p-4 lg:mb-0">
        <button
          type="button"
          onClick={() => onNavigate('team')}
          aria-current={currentPage === 'team' ? 'page' : undefined}
          className={`mb-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 font-medium transition-all ${currentPage === 'team' ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/30' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
        >
          <Settings className="h-5 w-5 shrink-0" />
          {open && <span>Team Settings</span>}
        </button>
        <button
          onClick={onSignOut}
          aria-label={open ? undefined : 'Sign out'}
          title={open ? undefined : 'Sign out'}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-all"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {open && <span>Sign Out</span>}
        </button>
      </div>
    </motion.aside>
  );
}

// Header Component  
function Header({ user, onToggleSidebar, overdueCount, workspaceName, workspaces, activeWorkspaceId, onSelectWorkspace, onGlobalSearch, globalSearchResults = [], globalSearchLoading = false, onGlobalResultClick }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => onGlobalSearch?.(query), 250);
    return () => clearTimeout(timer);
  }, [query, onGlobalSearch]);

  return (
    <header className="bg-white/50 backdrop-blur-xl border-b border-gray-200 px-4 py-3 md:px-8 md:py-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label="Toggle navigation sidebar"
          title="Toggle navigation sidebar"
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Menu className="w-6 h-6 text-gray-700" />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          {workspaces.length > 0 && (
            <select aria-label="Active workspace" value={activeWorkspaceId || ''} onChange={(event) => onSelectWorkspace(event.target.value)} className="hidden max-w-44 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm font-semibold text-gray-700 md:block">
              {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          )}
          <div className="relative hidden min-w-0 flex-1 max-w-xl md:block">
            <label className="sr-only" htmlFor="global-crm-search">Search CRM</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input id="global-crm-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search leads, contacts, deals, invoices…" className="min-h-10 w-full rounded-xl border border-gray-200 bg-white/80 pl-9 pr-10 text-sm text-gray-800 outline-none ring-indigo-500 focus:ring-2" />
            {globalSearchLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-label="Searching" />}
            {!globalSearchLoading && query.trim().length >= 2 && globalSearchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                {globalSearchResults.map(result => <button key={`${result.type}-${result.id}`} type="button" onClick={() => { setQuery(''); onGlobalResultClick?.(result); }} className="block w-full border-b border-gray-100 px-4 py-3 text-left last:border-0 hover:bg-gray-50"><span className="block truncate text-sm font-semibold text-gray-900">{result.title}</span><span className="mt-1 block truncate text-xs text-gray-500">{result.type} · {result.subtitle || 'No additional details'}</span></button>)}
              </div>
            )}
          </div>
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-600">{overdueCount} overdue reminders</span>
            </div>
          )}
          
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user.fullName || user.primaryEmailAddress?.emailAddress || 'CRM User'}
              </p>
              <p className="text-xs text-gray-500">
                {user.primaryEmailAddress?.emailAddress || ''}
              </p>
            </div>
            <div className="w-10 h-10 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function MobileBottomNav({ currentPage, onNavigate, onOpenMenu }) {
  const items = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'leads', label: 'Leads', icon: Users },
    { id: 'activities', label: 'My Day', icon: ListTodo },
    { id: 'deals', label: 'Deals', icon: Target },
    { id: 'pipeline', label: 'Pipeline', icon: Activity },
  ];

  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 flex border-t border-gray-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
      {items.map(({ id, label, icon: Icon }) => {
        const active = currentPage === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            className={`mobile-nav-item touch-manipulation flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors ${active ? 'bg-indigo-50 text-[#6366F1]' : 'text-gray-500'}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function PriorityAction({ icon: Icon, label, value, tone, onClick }) {
  const tones = {
    red: 'bg-red-50 text-red-700 border-red-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100'
  };

  return (
    <button type="button" onClick={onClick} className={`flex items-center justify-between rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tones[tone]}`}>
      <span className="flex items-center gap-3">
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">{label}</span>
      </span>
      <span className="text-xl font-bold">{value}</span>
    </button>
  );
}

// Dashboard Component
function Dashboard({ stats, summary, trendRange = '7', onTrendRangeChange, activities, meetings, leads, invoices = [], customers = [], onNavigate, onAddLead }) {
  // Prepare Data for Charts
  const stageCounts = new Map((summary?.stages || []).map(item => [item.stage, item.count]));
  const pipelineData = PIPELINE_STAGES.map(stage => ({
    name: stage.label,
    count: summary?.stages ? Number(stageCounts.get(stage.id) || 0) : leads.filter(l => l.stage === stage.id).length,
    color: stage.color
  }));

  const sourceData = leads.reduce((acc, lead) => {
    const source = lead.source || 'Unknown';
    const existing = acc.find(i => i.name === source);
    if (existing) {
      existing.value += 1;
    } else {
      acc.push({ name: source, value: 1 });
    }
    return acc;
  }, []);
  
  const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'];

  // Invoice Analytics
  const invoiceStats = {
    total: summary?.invoices?.total ?? invoices.length,
    paid: summary?.invoices?.paid ?? invoices.filter(i => i.status === 'paid').length,
    overdue: summary?.invoices?.overdue ?? invoices.filter(i => {
      if (i.status === 'paid' || i.status === 'cancelled') return false;
      return new Date(i.due_date) < new Date();
    }).length,
    draft: summary?.invoices?.draft ?? invoices.filter(i => i.status === 'draft').length,
    totalRevenue: summary?.invoices?.totalRevenue ?? invoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0),
    outstanding: summary?.invoices?.outstanding ?? invoices
      .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .reduce((sum, i) => sum + parseFloat(i.balance_due || i.total_amount || 0), 0),
    thisMonthRevenue: summary?.invoices?.thisMonthRevenue ?? invoices
      .filter(i => {
        if (i.status !== 'paid') return false;
        const paidDate = new Date(i.paid_at || i.invoice_date);
        const now = new Date();
        return paidDate.getMonth() === now.getMonth() && 
               paidDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0),
  };

  // Revenue Trend
  const trendDays = Number(trendRange);
  const revenueTrendData = summary?.revenueTrend?.length === trendDays
    ? summary.revenueTrend.map(item => ({
      ...item,
      date: new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }))
    : [...Array(trendDays)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (trendDays - 1 - i));
      const dateStr = d.toISOString().split('T')[0];

      const dayRevenue = invoices
        .filter(inv => {
          if (inv.status !== 'paid') return false;
          const invDate = (inv.paid_at || inv.invoice_date).split('T')[0];
          return invDate === dateStr;
        })
        .reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);

      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: dayRevenue,
        leads: leads.filter(l => {
          const leadDate = new Date(l.createdAt).toISOString().split('T')[0];
          return leadDate === dateStr;
        }).length
      };
    });

  // Overdue Invoices
  const overdueInvoices = invoices.filter(i => {
    if (i.status === 'paid' || i.status === 'cancelled') return false;
    return new Date(i.due_date) < new Date();
  }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  const upcomingMeetings = meetings
    .filter(m => new Date(m.dateTime).getTime() > new Date().getTime())
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
    .slice(0, 5);

  const overdueReminders = leads
    .flatMap(lead => 
      (lead.reminders || [])
        .filter(r => new Date(r.date) < new Date() && !r.completed)
        .map(r => ({ ...r, leadName: lead.name, leadId: lead.id }))
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const upcomingReminders = leads
    .flatMap(lead =>
      (lead.reminders || [])
        .filter(reminder => !reminder.completed && new Date(reminder.date) >= new Date() && new Date(reminder.date) <= weekFromNow)
        .map(reminder => ({ ...reminder, leadName: lead.name, leadId: lead.id }))
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Phase 2 exposes real deal totals through the dashboard aggregate. Keep the
  // legacy page read-only until the Phase 3 deal UI replaces this view.
  const pipelineValue = Number(summary?.deals?.openPipelineAmount || 0);
  const weightedPipelineValue = Number(summary?.deals?.weightedPipelineAmount || 0);

  const todayMeetings = upcomingMeetings.filter(meeting => new Date(meeting.dateTime).toDateString() === new Date().toDateString());
  const priorityCount = overdueInvoices.length + overdueReminders.length + todayMeetings.length;
  const isFirstUse = leads.length === 0 && meetings.length === 0 && invoices.length === 0 && customers.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Hero Section with Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#6366F1] via-[#8B5CF6] to-[#EC4899] rounded-3xl p-8 text-white shadow-2xl">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Floating Elements */}
        <div className="absolute top-4 right-4 opacity-20">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="40" stroke="white" strokeWidth="2" strokeDasharray="5,5"/>
            <circle cx="60" cy="60" r="25" fill="white" opacity="0.3"/>
          </svg>
        </div>

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Welcome back! 👋</h1>
                <p className="text-white/80 text-sm mt-1">Here's what's happening with your business today</p>
              </div>
            </div>
          </div>
          
          <button
            onClick={onAddLead}
            className="flex items-center gap-2 px-6 py-3 bg-white text-[#6366F1] rounded-xl font-semibold hover:shadow-2xl hover:scale-105 transition-all"
          >
            <Plus className="w-5 h-5" />
            Add New Lead
          </button>
        </div>

      </div>

      {isFirstUse && (
        <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="getting-started-title">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#6366F1]">GETTING STARTED</p>
              <h2 id="getting-started-title" className="mt-1 text-xl font-bold text-gray-900">Build your first sales workflow</h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">Start with a lead, move it through the pipeline, then schedule the next conversation when it matters.</p>
            </div>
            <button type="button" onClick={onAddLead} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#6366F1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5558d9] focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add your first lead
            </button>
          </div>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ['1', 'Capture a lead', 'Add contact details and a source.'],
              ['2', 'Qualify the opportunity', 'Use the pipeline to track progress.'],
              ['3', 'Schedule follow-up', 'Create a meeting or reminder.'],
            ].map(([number, title, description]) => (
              <li key={number} className="flex gap-3 rounded-xl bg-gray-50 p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-[#6366F1]">{number}</span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-600">{description}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => onNavigate('pipeline')} className="text-sm font-semibold text-[#6366F1] hover:text-[#4f46e5]">Explore the pipeline →</button>
          </div>
        </section>
      )}

      {/* Priority work */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="priority-work-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="priority-work-title" className="text-lg font-bold text-gray-900">Priority work</h2>
            <p className="mt-1 text-sm text-gray-500">The items most likely to need your attention today.</p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${priorityCount ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {priorityCount ? `${priorityCount} item${priorityCount === 1 ? '' : 's'} to review` : 'All clear'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PriorityAction icon={AlertCircle} label="Overdue invoices" value={overdueInvoices.length} tone="red" onClick={() => onNavigate('invoices')} />
          <PriorityAction icon={Clock} label="Overdue reminders" value={overdueReminders.length} tone="orange" onClick={() => onNavigate('pipeline')} />
          <PriorityAction icon={CheckCircle2} label="Follow-ups this week" value={upcomingReminders.length} tone="blue" onClick={() => onNavigate('leads')} />
          <PriorityAction icon={Calendar} label="Meetings today" value={todayMeetings.length} tone="blue" onClick={() => onNavigate('meetings')} />
        </div>
      </section>

      {upcomingReminders.length > 0 && (
        <section className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5 shadow-sm" aria-labelledby="upcoming-follow-ups-title">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="upcoming-follow-ups-title" className="text-lg font-bold text-gray-900">Upcoming follow-ups</h2>
              <p className="mt-1 text-sm text-gray-600">Keep momentum by acting on the next seven days of planned outreach.</p>
            </div>
            <button type="button" onClick={() => onNavigate('leads')} className="shrink-0 text-sm font-semibold text-[#6366F1] hover:text-[#4f46e5]">View leads →</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {upcomingReminders.slice(0, 3).map(reminder => (
              <button key={reminder.id} type="button" onClick={() => onNavigate('leads')} className="rounded-xl border border-blue-100 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm font-semibold text-gray-900">{reminder.note}</p>
                  <Clock className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                </div>
                <p className="mt-2 text-xs text-gray-500">{reminder.leadName} · {new Date(reminder.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Financial Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Revenue */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <DollarSign className="w-full h-full text-green-600" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
              <span className="text-xs font-semibold px-2 py-1 bg-green-50 text-green-600 rounded-full">
                {invoiceStats.paid} paid
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">
              ${(invoiceStats.totalRevenue / 1000).toFixed(1)}K
            </h3>
            <p className="text-gray-600 text-sm">Total Revenue</p>
          </div>
        </motion.div>

        {/* Outstanding Amount */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <Clock className="w-full h-full text-orange-600" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-orange-600" />
              </div>
              <span className="text-xs font-semibold px-2 py-1 bg-orange-50 text-orange-600 rounded-full">
                Pending
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">
              ${(invoiceStats.outstanding / 1000).toFixed(1)}K
            </h3>
            <p className="text-gray-600 text-sm">Outstanding</p>
          </div>
        </motion.div>

        {/* Total Invoices */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <FileText className="w-full h-full text-blue-600" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{invoiceStats.total}</h3>
            <p className="text-gray-600 text-sm">Total Invoices</p>
          </div>
        </motion.div>

        {/* Overdue Invoices */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <AlertCircle className="w-full h-full text-red-600" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              {invoiceStats.overdue > 0 && (
                <span className="text-xs font-semibold px-2 py-1 bg-red-50 text-red-600 rounded-full animate-pulse">
                  Urgent!
                </span>
              )}
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{invoiceStats.overdue}</h3>
            <p className="text-gray-600 text-sm">Overdue Invoices</p>
          </div>
        </motion.div>
      </div>

      {/* Revenue Trend Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue & Leads Chart */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Revenue & Leads Trend</h3>
              <p className="text-sm text-gray-500">Revenue collected and new leads</p>
            </div>
            <div className="flex items-center gap-3">
              <select
                aria-label="Trend time range"
                value={trendRange}
                onChange={(event) => onTrendRangeChange?.(event.target.value)}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-700 focus:ring-2 focus:ring-[#6366F1]"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
              <div className="hidden h-10 w-10 items-center justify-center rounded-lg bg-blue-50 sm:flex">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={revenueTrendData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <RechartsTooltip 
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#10B981" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorRevenue)" 
                name="Revenue ($)"
              />
              <Area 
                type="monotone" 
                dataKey="leads" 
                stroke="#6366F1" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorLeads)" 
                name="New Leads"
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Pipeline Distribution */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Pipeline Distribution</h3>
              <p className="text-sm text-gray-500">Leads by stage</p>
            </div>
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-purple-600" />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pipelineData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="count"
              >
                {pipelineData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip 
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {pipelineData.slice(0, 4).map((stage, index) => (
              <div key={index} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: stage.color }}
                />
                <span className="text-xs text-gray-600">{stage.name}: {stage.count}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Overdue Invoices Alert */}
      {overdueInvoices.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-2xl p-6"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                🚨 {overdueInvoices.length} Overdue Invoice{overdueInvoices.length > 1 ? 's' : ''}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                These invoices are past their due date and require immediate attention.
              </p>
              <div className="space-y-3">
                {overdueInvoices.slice(0, 3).map((invoice, index) => {
                  const customer = customers.find(c => c.id === invoice.customer_id);
                  const daysOverdue = Math.floor((new Date() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border border-red-100">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                          <FileText className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{invoice.invoice_number}</p>
                          <p className="text-sm text-gray-600">{customer?.name || 'Unknown Customer'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-red-600">${parseFloat(invoice.balance_due || invoice.total_amount).toFixed(2)}</p>
                        <p className="text-xs text-red-500">{daysOverdue} day{daysOverdue > 1 ? 's' : ''} overdue</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {overdueInvoices.length > 3 && (
                <button
                  onClick={() => onNavigate('invoices')}
                  className="mt-4 text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  View all {overdueInvoices.length} overdue invoices →
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Lead Stats Cards (keeping existing) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <svg viewBox="0 0 100 100" fill="currentColor" className="text-blue-600">
              <circle cx="30" cy="30" r="8"/>
              <circle cx="70" cy="30" r="8"/>
              <circle cx="50" cy="60" r="8"/>
              <circle cx="30" cy="90" r="8"/>
              <circle cx="70" cy="90" r="8"/>
              <line x1="30" y1="30" x2="50" y2="60" stroke="currentColor" strokeWidth="3"/>
              <line x1="70" y1="30" x2="50" y2="60" stroke="currentColor" strokeWidth="3"/>
              <line x1="50" y1="60" x2="30" y2="90" stroke="currentColor" strokeWidth="3"/>
              <line x1="50" y1="60" x2="70" y2="90" stroke="currentColor" strokeWidth="3"/>
            </svg>
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <span className="text-xs font-semibold px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
                Active
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.totalLeads}</h3>
            <p className="text-gray-600 text-sm">Total Leads</p>
          </div>
        </motion.div>

        {/* New Leads Card */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <svg viewBox="0 0 100 100" fill="currentColor" className="text-purple-600">
              <path d="M50 10 L60 40 L90 40 L65 60 L75 90 L50 70 L25 90 L35 60 L10 40 L40 40 Z"/>
            </svg>
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-purple-600" />
              </div>
              <span className="text-xs font-semibold px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
                New
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.newLeads}</h3>
            <p className="text-gray-600 text-sm">New This Month</p>
          </div>
        </motion.div>

        {/* Proposals Card */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <svg viewBox="0 0 100 100" fill="currentColor" className="text-orange-600">
              <rect x="20" y="20" width="60" height="70" rx="5"/>
              <line x1="30" y1="35" x2="70" y2="35" stroke="white" strokeWidth="3"/>
              <line x1="30" y1="50" x2="70" y2="50" stroke="white" strokeWidth="3"/>
              <line x1="30" y1="65" x2="55" y2="65" stroke="white" strokeWidth="3"/>
            </svg>
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-orange-600" />
              </div>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.proposals}</h3>
            <p className="text-gray-600 text-sm">Active Proposals</p>
          </div>
        </motion.div>

        {/* Closed Won Card */}
        <motion.div
          whileHover={{ y: -5 }}
          className="relative overflow-hidden bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <svg viewBox="0 0 100 100" fill="currentColor" className="text-green-600">
              <circle cx="50" cy="50" r="40"/>
              <path d="M30 50 L45 65 L70 35" stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <span className="text-xs font-semibold px-2 py-1 bg-green-50 text-green-600 rounded-full">
                Won
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.closedWon}</h3>
            <p className="text-gray-600 text-sm">Deals Closed</p>
          </div>
        </motion.div>
      </div>

      {/* Bottom Section - Meetings & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Meetings */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Upcoming Meetings</h2>
              <p className="text-sm text-gray-500 mt-1">{upcomingMeetings.length} scheduled</p>
            </div>
            <button
              onClick={() => onNavigate('meetings')}
              className="text-sm text-[#6366F1] hover:text-[#8B5CF6] font-medium flex items-center gap-1"
            >
              View All
              <ChevronLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>

          <div className="space-y-3">
            {upcomingMeetings.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Calendar className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500">No upcoming meetings</p>
                <button
                  onClick={() => onNavigate('meetings')}
                  className="mt-3 text-sm text-[#6366F1] hover:text-[#8B5CF6] font-medium"
                >
                  Schedule one now
                </button>
              </div>
            ) : (
              upcomingMeetings.map(meeting => {
                const lead = leads.find(l => l.id === meeting.leadId);
                const meetingDate = new Date(meeting.dateTime);
                const isToday = meetingDate.toDateString() === new Date().toDateString();
                
                return (
                  <motion.div
                    key={meeting.id}
                    whileHover={{ x: 5 }}
                    className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                    onClick={() => onNavigate('meetings')}
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-xl flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{meeting.title}</h3>
                      <p className="text-sm text-gray-600 truncate">{lead?.name || 'Unknown'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        isToday ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {isToday ? 'Today' : meetingDate.toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {meetingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Recent Activity</h2>
              <p className="text-sm text-gray-500 mt-1">Latest updates</p>
            </div>
            <div className="w-10 h-10 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-green-600" />
            </div>
          </div>

          <div className="space-y-4">
            {activities.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Activity className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500">No recent activity</p>
              </div>
            ) : (
              activities.slice(0, 5).map((activity, index) => {
                const icons = {
                  lead_added: { icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
                  lead_updated: { icon: Edit2, color: 'text-purple-600', bg: 'bg-purple-50' },
                  meeting_scheduled: { icon: Calendar, color: 'text-green-600', bg: 'bg-green-50' },
                  deal_closed: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' }
                };
                const config = icons[activity.type] || icons.lead_added;
                const Icon = config.icon;

                return (
                  <motion.div
                    key={activity.id || index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-start gap-3"
                  >
                    <div className={`w-9 h-9 ${config.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{activity.message}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Overdue Reminders Alert */}
      {overdueReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-2xl p-6"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                ⚠️ {overdueReminders.length} Overdue Reminder{overdueReminders.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-2">
                {overdueReminders.slice(0, 3).map((reminder, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-gray-700">
                      <strong>{reminder.leadName}:</strong> {reminder.note}
                    </span>
                    <span className="text-red-600 text-xs">
                      ({new Date(reminder.date).toLocaleDateString()})
                    </span>
                  </div>
                ))}
              </div>
              {overdueReminders.length > 3 && (
                <button
                  onClick={() => onNavigate('pipeline')}
                  className="mt-3 text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  View all {overdueReminders.length} reminders →
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function TeamSettingsPage({ user, teamData, receivedInvitations, activeWorkspaceId, onSelectWorkspace, onInvite, onRename, onChangeRole, onRemove, onRevoke, onAccept }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [workspaceName, setWorkspaceName] = useState(teamData?.workspace?.name || '');
  const [saving, setSaving] = useState(false);
  const workspace = teamData?.workspace;
  const canManage = ['owner', 'admin'].includes(workspace?.role);
  const isOwner = workspace?.role === 'owner';

  const invite = async (event) => {
    event.preventDefault();
    setSaving(true);
    try { await onInvite(email, role); setEmail(''); } finally { setSaving(false); }
  };

  useEffect(() => setWorkspaceName(teamData?.workspace?.name || ''), [teamData?.workspace?.name]);

  if (!teamData) return <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading team settings…</div>;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <PageHeader title="Team Settings" description={`Manage access to ${workspace.name}.`} />
      {teamData.workspaces.length > 1 && <label className="block md:hidden"><span className="mb-2 block text-sm font-semibold text-gray-700">Active workspace</span><select value={activeWorkspaceId || ''} onChange={event => onSelectWorkspace(event.target.value)} className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700">{teamData.workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {receivedInvitations.length > 0 && <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h2 className="text-lg font-bold text-indigo-950">Workspace invitations</h2><div className="mt-3 space-y-3">{receivedInvitations.map(invite => <div key={invite.id} className="flex flex-col gap-3 rounded-xl bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-gray-900">Join {invite.workspace_name}</p><p className="text-sm text-gray-500">Role: {invite.role}</p></div><button type="button" onClick={() => onAccept(invite.id)} className="rounded-lg bg-[#6366F1] px-4 py-2 text-sm font-semibold text-white">Accept invitation</button></div>)}</div></section>}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-50 p-3 text-[#6366F1]"><Shield className="h-6 w-6" /></div><div><h2 className="font-bold text-gray-900">{workspace.name}</h2><p className="text-sm text-gray-500">Your role: <span className="capitalize font-semibold">{workspace.role}</span></p></div></div>{isOwner && <form onSubmit={async event => { event.preventDefault(); await onRename(workspaceName); }} className="mt-5 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row"><label className="sr-only" htmlFor="workspace-name">Workspace name</label><input id="workspace-name" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3" /><button className="min-h-11 rounded-lg border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-[#6366F1]">Save name</button></form>}</section>
      {canManage && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-gray-900">Invite a teammate</h2><p className="mt-1 text-sm text-gray-500">They can accept the invite after creating or signing into their CRM account.</p><form onSubmit={invite} className="mt-4 flex flex-col gap-3 sm:flex-row"><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="teammate@company.com" className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3" /><select value={role} onChange={event => setRole(event.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-3"><option value="member">Member</option><option value="admin">Admin</option></select><button disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#6366F1] px-4 text-sm font-semibold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />Invite</button></form></section>}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-900">Members</h2></div><div className="divide-y divide-gray-100">{teamData.members.map(member => <div key={member.user_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-gray-900">{member.email || (member.user_id === user.id ? user.primaryEmailAddress?.emailAddress : 'Workspace member')}</p><p className="text-sm capitalize text-gray-500">{member.role}</p></div>{member.role !== 'owner' && canManage && <div className="flex gap-2">{isOwner && <select value={member.role} onChange={event => onChangeRole(member.user_id, event.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm"><option value="admin">Admin</option><option value="member">Member</option></select>}<button type="button" onClick={() => onRemove(member.user_id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600"><UserMinus className="h-4 w-4" />Remove</button></div>}</div>)}</div></section>
      {canManage && teamData.invitations.length > 0 && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-gray-900">Pending invitations</h2><div className="mt-3 space-y-3">{teamData.invitations.map(invite => <div key={invite.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3"><div><p className="font-medium text-gray-900">{invite.email}</p><p className="text-xs capitalize text-gray-500">{invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}</p></div><button type="button" onClick={() => onRevoke(invite.id)} className="text-sm font-semibold text-red-600">Revoke</button></div>)}</div></section>}
    </motion.div>
  );
}

// Stat Card Component
function StatCard({ label, value, icon: Icon, color, trend }) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="backdrop-blur-xl rounded-2xl p-6 transition-all bg-white border border-gray-200 hover:border-gray-300 shadow-sm"
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
        {trend && (
          <span className="text-green-600 text-sm font-semibold">{trend}</span>
        )}
      </div>
      <p className="text-sm mb-1 text-gray-600">
        {label}
      </p>
      <p className="text-3xl font-bold text-gray-900">
        {value}
      </p>
    </motion.div>
  );
}

function CRMButton({ variant = 'primary', type = 'button', children, className = '', ...props }) {
  return <button type={type} className={`crm-btn crm-btn-${variant} ${className}`} {...props}>{children}</button>;
}

function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

function CRMCard({ children, className = '' }) {
  return <div className={`crm-card ${className}`}>{children}</div>;
}

// Updated LeadsPage (Now correctly calls the dynamic PDF generator)
function LeadsPage({ 
  leads, 
  searchTerm, 
  setSearchTerm, 
  filterStage, 
  setFilterStage,
  onAddLead,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onBulkUpdateStage,
  onBulkDelete,
  onRequestConfirm,
  onExport
}) {
  const [sourceFilter, setSourceFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [leadPage, setLeadPage] = useState(1);
  const pageSize = 25;
  const sources = [...new Set(leads.map(lead => lead.source).filter(Boolean))].sort();

  // Sort leads by Score (Highest first)
  const sortedLeads = [...leads]
    .filter(lead => sourceFilter === 'all' || lead.source === sourceFilter)
    .filter(lead => scoreFilter === 'all' || calculateLeadScore(lead) >= Number(scoreFilter))
    .sort((a, b) => calculateLeadScore(b) - calculateLeadScore(a));
  const pageCount = Math.max(1, Math.ceil(sortedLeads.length / pageSize));
  const visibleLeads = sortedLeads.slice((leadPage - 1) * pageSize, leadPage * pageSize);
  const allVisibleSelected = visibleLeads.length > 0 && visibleLeads.every(lead => selectedIds.includes(lead.id));

  useEffect(() => {
    setLeadPage(1);
  }, [searchTerm, filterStage, sourceFilter, scoreFilter]);

  useEffect(() => {
    if (leadPage > pageCount) setLeadPage(pageCount);
  }, [leadPage, pageCount]);

  const toggleSelected = (leadId) => setSelectedIds(prev => prev.includes(leadId) ? prev.filter(id => id !== leadId) : [...prev, leadId]);
  const toggleAll = () => setSelectedIds(prev => {
    const visibleIds = visibleLeads.map(lead => lead.id);
    return allVisibleSelected ? prev.filter(id => !visibleIds.includes(id)) : [...new Set([...prev, ...visibleIds])];
  });
  const clearSelection = () => setSelectedIds([]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PageHeader
        title="Leads"
        description="Priority-scored leads, sorted for follow-up."
        actions={<>
          <CRMButton variant="secondary" onClick={onExport}>
            <Download className="w-4 h-4" />
            Export CSV
          </CRMButton>
          <CRMButton onClick={onAddLead}>
            <Plus className="w-5 h-5" />
            Add Lead
          </CRMButton>
        </>}
      />

      {/* Filters */}
      <CRMCard className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400"
            />
          </div>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="px-4 py-3 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none bg-gray-50 border border-gray-200 text-gray-900"
          >
            <option value="all">All Stages</option>
            {PIPELINE_STAGES.map(stage => (
              <option key={stage.id} value={stage.id}>{stage.label}</option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#6366F1]">
            <option value="all">All sources</option>
            {sources.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
          <select value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#6366F1]">
            <option value="all">Any priority</option>
            <option value="60">Hot (60+)</option>
            <option value="30">Warm or hotter (30+)</option>
          </select>
        </div>
      </CRMCard>

      {selectedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-indigo-900">{selectedIds.length} lead{selectedIds.length === 1 ? '' : 's'} selected</p>
          <div className="flex flex-wrap items-center gap-2">
            <select defaultValue="" onChange={(event) => { if (event.target.value) { onBulkUpdateStage(selectedIds, event.target.value); clearSelection(); event.target.value = ''; } }} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-gray-700">
              <option value="">Move to stage…</option>
              {PIPELINE_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => {
                void onRequestConfirm({
                  title: `Delete ${selectedIds.length} selected lead${selectedIds.length === 1 ? '' : 's'}?`,
                  description: 'This action cannot be undone.',
                  confirmLabel: 'Delete leads',
                }).then(confirmed => {
                  if (confirmed) {
                    onBulkDelete(selectedIds);
                    clearSelection();
                  }
                });
              }}
              className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
            <button type="button" onClick={clearSelection} className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">Clear</button>
          </div>
        </div>
      )}

      {/* Leads Table */}
      {sortedLeads.length === 0 ? (
        <EmptyState
          icon={Users}
          title={searchTerm || filterStage !== 'all' ? 'No leads match your filters' : 'No leads yet'}
          description={searchTerm || filterStage !== 'all' ? 'Try clearing a filter or searching for a different lead.' : 'Add your first lead to start building your pipeline.'}
          actionLabel={searchTerm || filterStage !== 'all' ? undefined : 'Add your first lead'}
          onAction={searchTerm || filterStage !== 'all' ? undefined : onAddLead}
        />
      ) : (
      <>
      <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-12 px-4 py-4"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all visible leads" /></th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Priority Score</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Name</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Company</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Contact</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Stage</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Created</th>
                <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {visibleLeads.map(lead => {
                const stage = PIPELINE_STAGES.find(s => s.id === lead.stage);
                const score = calculateLeadScore(lead);
                const scoreConfig = getScoreConfig(score);
                const ScoreIcon = scoreConfig.icon;

                return (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4"><input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelected(lead.id)} aria-label={`Select ${lead.name}`} /></td>
                    {/* Priority Score Column */}
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-xs font-bold ${scoreConfig.bg} ${scoreConfig.color}`}>
                        <ScoreIcon className="w-3 h-3" />
                        {score} - {scoreConfig.label}
                      </div>
                    </td>
                    
                    {/* Name Column */}
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        <button type="button" onClick={() => onViewLead(lead)} className="text-left hover:text-[#6366F1]">
                          {lead.name}
                        </button>
                      </div>
                    </td>

                    {/* Company Column */}
                    <td className="px-6 py-4">
                      <div className="text-gray-600">
                        {lead.company || '-'}
                      </div>
                    </td>

                    {/* Contact Column */}
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail className="w-3 h-3" />
                          {lead.email}
                        </div>
                        {lead.phone && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Phone className="w-3 h-3" />
                            {lead.phone}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Stage Column */}
                    <td className="px-6 py-4">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: `${stage?.color}15`,
                          color: stage?.color
                        }}
                      >
                        {stage?.label}
                      </span>
                    </td>

                    {/* Created Column */}
                    <td className="px-6 py-4">
                      <div className="text-gray-600 text-sm">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </div>
                    </td>

                    {/* Actions Column */}
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* Email Button */}
                        <a
                          href={generateEmailUrl(lead)}
                          className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                          title="Send Email"
                        >
                          <Mail className="w-4 h-4" />
                        </a>

                        {/* Calendar Button */}
                        <a
                          href={generateCalendarUrl(lead)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 hover:bg-purple-50 rounded-lg transition-colors text-purple-600"
                          title="Schedule on Google Calendar"
                        >
                          <Calendar className="w-4 h-4" />
                        </a>

                        {/* ✅ PDF Quote Button (FIXED) */}
                        <button
                          onClick={() => void generateQuotePDF(lead)}
                          className="p-2 hover:bg-green-50 rounded-lg transition-colors text-green-600"
                          title="Generate PDF Quote"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>

                        <button
                          onClick={() => onEditLead(lead)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
                          title="Edit Lead"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            void onRequestConfirm({
                              title: 'Delete this lead?',
                              description: `Delete ${lead.name}? This action cannot be undone.`,
                              confirmLabel: 'Delete lead',
                            }).then(confirmed => {
                              if (confirmed) onDeleteLead(lead.id);
                            });
                          }}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-500"
                          title="Delete Lead"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {visibleLeads.map(lead => {
          const stage = PIPELINE_STAGES.find(s => s.id === lead.stage);
          const score = calculateLeadScore(lead);
          const scoreConfig = getScoreConfig(score);
          const ScoreIcon = scoreConfig.icon;
          return (
            <article key={lead.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => onViewLead(lead)} className="min-w-0 text-left">
                  <h2 className="truncate font-semibold text-gray-900">{lead.name}</h2>
                  <p className="truncate text-sm text-gray-500">{lead.company || 'No company listed'}</p>
                </button>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${scoreConfig.bg} ${scoreConfig.color}`}>
                  <ScoreIcon className="h-3 w-3" aria-hidden="true" /> {score}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: `${stage?.color}15`, color: stage?.color }}>{stage?.label}</span>
                <span className="truncate text-gray-500">{lead.email}</span>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                <button type="button" onClick={() => onViewLead(lead)} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">View</button>
                <button type="button" onClick={() => onEditLead(lead)} className="rounded-lg px-3 py-2 text-sm font-medium text-[#6366F1] hover:bg-indigo-50">Edit</button>
                <button
                  type="button"
                  onClick={() => {
                    void onRequestConfirm({
                      title: 'Delete this lead?',
                      description: `Delete ${lead.name}? This action cannot be undone.`,
                      confirmLabel: 'Delete lead',
                    }).then(confirmed => {
                      if (confirmed) onDeleteLead(lead.id);
                    });
                  }}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {pageCount > 1 && (
        <nav aria-label="Lead list pagination" className="flex flex-col gap-3 border-t border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-0 md:pt-0">
          <p className="text-sm text-gray-500">Showing {(leadPage - 1) * pageSize + 1}–{Math.min(leadPage * pageSize, sortedLeads.length)} of {sortedLeads.length} leads</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setLeadPage(page => Math.max(1, page - 1))} disabled={leadPage === 1} className="min-h-10 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <span className="min-w-20 text-center text-sm font-medium text-gray-600">Page {leadPage} of {pageCount}</span>
            <button type="button" onClick={() => setLeadPage(page => Math.min(pageCount, page + 1))} disabled={leadPage === pageCount} className="min-h-10 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </nav>
      )}
      </>
      )}
    </motion.div>
  );
}

function LeadDetailDrawer({ lead, activities = [], onClose, onEdit }) {
  useModalBehavior(onClose);
  const stage = PIPELINE_STAGES.find(item => item.id === lead.stage);
  const score = calculateLeadScore(lead);
  const scoreConfig = getScoreConfig(score);
  const isClient = lead.__profileType === 'client';
  const leadActivity = activities.filter(activity => activity.lead_id === lead.id || activity.leadId === lead.id).slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/40" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="lead-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-200 p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{isClient ? 'Customer profile' : 'Lead details'}</p>
            <h2 id="lead-drawer-title" className="mt-1 truncate text-2xl font-bold text-gray-900">{lead.name}</h2>
            <p className="mt-1 text-sm text-gray-500">{lead.company || 'No company listed'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close lead details" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: `${stage?.color}15`, color: stage?.color }}>{stage?.label}</span>
            <span className={`inline-flex items-center gap-1 text-sm font-bold ${scoreConfig.color}`}>{score} {scoreConfig.label}</span>
          </div>
          <div className="space-y-4">
            <DetailRow icon={Mail} label="Email" value={lead.email} />
            <DetailRow icon={Phone} label="Phone" value={lead.phone || 'Not provided'} />
            <DetailRow icon={Building2} label="Company" value={lead.company || 'Not provided'} />
            <DetailRow icon={Clock} label="Created" value={new Date(lead.createdAt).toLocaleDateString()} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
            {lead.notes?.length ? <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{lead.notes[0].text}</p> : <p className="mt-2 text-sm text-gray-500">No notes added yet.</p>}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Activity timeline</h3>
            {leadActivity.length ? (
              <div className="mt-3 space-y-3 border-l-2 border-indigo-100 pl-4">
                {leadActivity.map((activity, index) => (
                  <div key={activity.id || index} className="relative">
                    <span className="absolute -left-[1.35rem] top-1 h-2 w-2 rounded-full bg-[#6366F1]" />
                    <p className="text-sm text-gray-700">{activity.message}</p>
                    <p className="mt-1 text-xs text-gray-400">{activity.created_at ? new Date(activity.created_at).toLocaleString() : 'Recent'}</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-gray-500">No activity recorded for this lead yet.</p>}
          </div>
        </div>
        <div className="flex gap-3 border-t border-gray-200 p-6">
          <button type="button" onClick={onEdit} className="flex-1 rounded-xl bg-[#6366F1] px-4 py-3 text-sm font-semibold text-white hover:bg-[#5558d9]">{isClient ? 'Edit customer' : 'Edit lead'}</button>
          <a href={generateEmailUrl(lead)} className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">Email</a>
        </div>
      </aside>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 text-gray-400" aria-hidden="true" /><div><p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p><p className="mt-0.5 break-words text-sm text-gray-700">{value}</p></div></div>;
}

// Clients Page Component
function ClientsPage({ clients, onViewClient }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-3xl font-bold mb-2 text-gray-900">
          Clients
        </h1>
        <p className="text-gray-600">
          Manage your closed-won clients
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clients.map(client => (
          <motion.div
            key={client.id}
            whileHover={{ y: -4 }}
            className="backdrop-blur-xl rounded-2xl p-6 transition-all cursor-pointer bg-white border border-gray-200 hover:border-green-400 shadow-sm"
            onClick={() => onViewClient(client)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1 text-gray-900">
                  {client.name}
                </h3>
                {client.company && (
                  <p className="text-sm flex items-center gap-2 text-gray-600">
                    <Building2 className="w-4 h-4" />
                    {client.company}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="w-4 h-4" />
                {client.email}
              </div>
              {client.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="w-4 h-4" />
                  {client.phone}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Client since {new Date(client.createdAt).toLocaleDateString()}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {clients.length === 0 && (
        <div className="text-center py-12">
          <Target className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No clients yet</p>
        </div>
      )}
    </motion.div>
  );
}

// Pipeline Page Component
function PipelinePage({ leads, view, setView, onDragEnd, onEditLead, searchTerm, setSearchTerm }) {
  const activeLeads = leads.filter(lead => !['closed-won', 'closed-lost'].includes(lead.stage)).length;
  const wonLeads = leads.filter(lead => lead.stage === 'closed-won').length;
  const closedLeads = leads.filter(lead => ['closed-won', 'closed-lost'].includes(lead.stage)).length;
  const conversionRate = closedLeads ? Math.round((wonLeads / closedLeads) * 100) : 0;
  const overdueFollowUps = leads.reduce((count, lead) => (
    count + (lead.reminders || []).filter(reminder => !reminder.completed && new Date(reminder.date) < new Date()).length
  ), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader title="Sales Pipeline" description="Track leads through your sales process." />
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-3 pl-10 pr-4 text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-[#6366F1] lg:w-64 lg:py-2"
            />
          </div>
          <div className="grid w-full grid-cols-2 rounded-lg border border-gray-300 bg-white p-1 lg:w-auto">
            <button
              onClick={() => setView('kanban')}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 transition-all ${
                view === 'kanban' 
                  ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Kanban
            </button>
            <button
              onClick={() => setView('table')}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 transition-all ${
                view === 'table' 
                  ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <List className="w-4 h-4" />
              Table
            </button>
          </div>
        </div>
      </div>

      <section aria-label="Pipeline summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Active opportunities', value: activeLeads, tone: 'border-indigo-100 bg-indigo-50 text-indigo-700' },
          { label: 'Won', value: wonLeads, tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
          { label: 'Close rate', value: `${conversionRate}%`, tone: 'border-violet-100 bg-violet-50 text-violet-700' },
          { label: 'Overdue follow-ups', value: overdueFollowUps, tone: overdueFollowUps ? 'border-red-100 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700' },
        ].map(metric => (
          <div key={metric.label} className={`rounded-xl border p-4 ${metric.tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{metric.label}</p>
            <p className="mt-2 text-2xl font-bold">{metric.value}</p>
          </div>
        ))}
      </section>

      {view === 'kanban' ? (
        <KanbanView leads={leads} onDragEnd={onDragEnd} onEditLead={onEditLead}  />
      ) : (
        <TableView leads={leads} onEditLead={onEditLead}  />
      )}
    </motion.div>
  );
}

// Kanban View Component
function KanbanView({ leads, onDragEnd, onEditLead }) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {PIPELINE_STAGES.map(stage => {
          const stageLeads = leads.filter(l => l.stage === stage.id);
          return (
            <div key={stage.id} className="flex flex-col">
              <div className="mb-3 flex min-h-24 flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex min-w-0 items-start gap-2">
                  <div
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">
                    {stage.label}
                  </h3>
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Leads</span>
                  <span className="text-2xl font-bold leading-none text-gray-900" aria-label={`${stageLeads.length} ${stageLeads.length === 1 ? 'lead' : 'leads'}`}>{stageLeads.length}</span>
                </div>
              </div>

              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 space-y-3 p-3 rounded-xl transition-colors border-2 ${
                      snapshot.isDraggingOver 
                        ? 'bg-[#6366F1]/5 border-gray-300' 
                        : 'bg-gray-100/50 border-gray-200'
                    }`}
                    style={{ minHeight: '500px' }}
                  >
                    {stageLeads.map((lead, index) => (
                      <Draggable key={lead.id} draggableId={lead.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`rounded-xl p-4 border transition-all cursor-move bg-white border-gray-200 hover:border-gray-400 shadow-sm ${snapshot.isDragging ? 'shadow-2xl shadow-[#6366F1]/20 rotate-2' : ''}`}
                            onClick={() => onEditLead(lead)}
                          >
                            <h4 className="font-semibold mb-2 text-gray-900">
                              {lead.name}
                            </h4>
                            {lead.company && (
                              <p className="text-sm mb-2 text-gray-600">
                                {lead.company}
                              </p>
                            )}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Mail className="w-3 h-3" />
                                {lead.email}
                              </div>
                              {lead.phone && (
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <Phone className="w-3 h-3" />
                                  {lead.phone}
                                </div>
                              )}
                            </div>
                            {lead.notes && lead.notes.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-xs line-clamp-2 text-gray-600">
                                  {lead.notes[0].text}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}

// Table View Component
function TableView({ leads, onEditLead }) {
  return (
    <div className="bg-white backdrop-blur-xl rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Lead</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Company</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Stage</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Source</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {leads.map(lead => {
              const stage = PIPELINE_STAGES.find(s => s.id === lead.stage);
              return (
                <tr
                  key={lead.id}
                  onClick={() => onEditLead(lead)}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{lead.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-600">{lead.company || '-'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold"
                      style={{
                        backgroundColor: `${stage?.color}15`,
                        color: stage?.color
                      }}
                    >
                      {stage?.label}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-3 h-3 text-gray-400" />
                        <span className="text-gray-600">{lead.email}</span>
                      </div>
                      {lead.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-600">{lead.phone}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-600">{lead.source || '-'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-600 text-sm">
                      {lead.notes && lead.notes.length > 0 
                        ? new Date(lead.notes[0].timestamp).toLocaleDateString()
                        : new Date(lead.createdAt).toLocaleDateString()
                      }
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Meetings Page Component (UPDATED with Edit/Delete buttons)
function MeetingsPage({ meetings, leads, onAddMeeting, onEditMeeting, onDeleteMeeting, onRequestConfirm }) {
  const upcomingMeetings = meetings.filter(m => new Date(m.dateTime) >= new Date());
  const pastMeetings = meetings.filter(m => new Date(m.dateTime) < new Date());

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PageHeader
        title="Meetings"
        description="Schedule and track client meetings."
        actions={<CRMButton onClick={onAddMeeting}>
          <Plus className="w-5 h-5" />
          Schedule Meeting
        </CRMButton>}
      />

      {/* Upcoming Meetings */}
      <div className="bg-white backdrop-blur-xl rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Upcoming Meetings</h2>
        <div className="space-y-4">
          {upcomingMeetings.length > 0 ? (
            upcomingMeetings.map(meeting => {
              const lead = leads.find(l => l.id === meeting.leadId);
              return (
                <div
                  key={meeting.id}
                  className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-400 transition-all"
                >
                  <div className="w-12 h-12 bg-[#8B5CF6]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-6 h-6 text-[#8B5CF6]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1 text-gray-900">{meeting.title}</h3>
                    {lead && (
                      <p className="text-sm text-gray-600 mb-2">
                        with {lead.name} {lead.company ? `(${lead.company})` : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {new Date(meeting.dateTime).toLocaleString()}
                      </div>
                      {meeting.googleEventId && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                          <Calendar className="w-3 h-3" />
                          Synced to Google
                        </span>
                      )}
                    </div>
                    {meeting.googleMeetLink && (
                      <a
                        href={meeting.googleMeetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M15 12c0 1.654-1.346 3-3 3s-3-1.346-3-3 1.346-3 3-3 3 1.346 3 3zm9-.449s-4.252 8.449-11.985 8.449c-7.18 0-12.015-8.449-12.015-8.449s4.446-7.551 12.015-7.551c7.694 0 11.985 7.551 11.985 7.551zm-7 .449c0-2.757-2.243-5-5-5s-5 2.243-5 5 2.243 5 5 5 5-2.243 5-5z"/>
                        </svg>
                        Join Google Meet
                      </a>
                    )}
                    {meeting.notes && (
                      <p className="mt-2 text-sm text-gray-600">{meeting.notes}</p>
                    )}
                  </div>
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEditMeeting(meeting)}
                      className="p-2 hover:bg-[#6366F1]/10 rounded-lg transition-colors"
                      title="Edit Meeting"
                    >
                      <Edit2 className="w-4 h-4 text-[#6366F1]" />
                    </button>
                    <button
                      onClick={() => {
                        void onRequestConfirm({
                          title: 'Delete this meeting?',
                          description: `Delete ${meeting.title}? This action cannot be undone.`,
                          confirmLabel: 'Delete meeting',
                        }).then(confirmed => {
                          if (confirmed) onDeleteMeeting(meeting.id);
                        });
                      }}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Meeting"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-gray-500 text-center py-8">No upcoming meetings</p>
          )}
        </div>
      </div>

      {/* Past Meetings */}
      {pastMeetings.length > 0 && (
        <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Past Meetings</h2>
          <div className="space-y-4">
            {pastMeetings.map(meeting => {
              const lead = leads.find(l => l.id === meeting.leadId);
              return (
                <div
                  key={meeting.id}
                  className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 opacity-60"
                >
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-6 h-6 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1 text-gray-900">{meeting.title}</h3>
                    {lead && (
                      <p className="text-sm text-gray-600 mb-2">
                        with {lead.name} {lead.company ? `(${lead.company})` : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {new Date(meeting.dateTime).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEditMeeting(meeting)}
                      className="p-2 hover:bg-[#6366F1]/10 rounded-lg transition-colors"
                      title="Edit Meeting"
                    >
                      <Edit2 className="w-4 h-4 text-[#6366F1]" />
                    </button>
                    <button
                      onClick={() => {
                        void onRequestConfirm({
                          title: 'Delete this meeting?',
                          description: `Delete ${meeting.title}? This action cannot be undone.`,
                          confirmLabel: 'Delete meeting',
                        }).then(confirmed => {
                          if (confirmed) onDeleteMeeting(meeting.id);
                        });
                      }}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Meeting"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Lead Modal Component
function LeadModal({ lead, onClose, onSave, onAddNote, onAddReminder, onCompleteReminder }) {
  useModalBehavior(onClose);
  const [formData, setFormData] = useState({
    name: lead?.name || '',
    company: lead?.company || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    source: lead?.source || '',
    stage: lead?.stage || 'new'
  });

  const [quoteItems, setQuoteItems] = useState(lead?.quoteItems || []);
  const [activeTab, setActiveTab] = useState('details');
  const [newNote, setNewNote] = useState('');
  const [newReminder, setNewReminder] = useState({
    date: '',
    note: ''
  });

  // Handle adding a new item row
  const addQuoteItem = () => {
    setQuoteItems([...quoteItems, { description: '', quantity: 1, price: 0 }]);
  };

  // Handle removing an item row
  const removeQuoteItem = (index) => {
    const newItems = [...quoteItems];
    newItems.splice(index, 1);
    setQuoteItems(newItems);
  };

  // Handle changing item values
  const updateQuoteItem = (index, field, value) => {
    const newItems = [...quoteItems];
    newItems[index][field] = value;
    setQuoteItems(newItems);
  };

  // Calculate total for preview
  const calculateTotal = () => {
    return quoteItems.reduce((sum, item) => {
      return sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0));
    }, 0);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...formData, quoteItems });
  };

  const handleAddNote = () => {
    if (newNote.trim() && lead) {
      onAddNote(lead.id, newNote);
      setNewNote('');
    }
  };

  const handleAddReminder = () => {
    if (newReminder.date && newReminder.note && lead) {
      onAddReminder(lead.id, newReminder);
      setNewReminder({ date: '', note: '' });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl border border-gray-200 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-modal-title"
        tabIndex="-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 id="lead-modal-title" className="text-2xl font-bold text-gray-900">
            {lead ? 'Edit Lead' : 'New Lead'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lead dialog"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs (only for existing leads) */}
        {lead && (
          <div className="flex gap-4 px-6 pt-4 border-b border-gray-200 overflow-x-auto">
            {['details', 'quote', 'notes', 'reminders'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-medium transition-all capitalize ${
                  activeTab === tab
                    ? 'text-[#6366F1] border-b-2 border-[#6366F1]'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab === 'quote' ? 'Quote Builder' : tab}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {(!lead || activeTab === 'details') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Company
                  </label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Source
                  </label>
                  <input
                    type="text"
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    placeholder="e.g., Website, Referral, LinkedIn"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Stage
                  </label>
                  <select
                    value={formData.stage}
                    onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                  >
                    {PIPELINE_STAGES.map(stage => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
                >
                  {lead ? 'Update Lead' : 'Create Lead'}
                </button>
              </div>
            </form>
          )}

          {/* QUOTE BUILDER TAB */}
          {lead && activeTab === 'quote' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Quote Items</h3>
                <button 
                  onClick={addQuoteItem}
                  className="text-sm px-3 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"
                >
                  + Add Item
                </button>
              </div>

              {quoteItems.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <p className="text-gray-500">No items in quote. Add an item to start.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {quoteItems.map((item, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <div className="flex-grow">
                        <input
                          type="text"
                          placeholder="Description (e.g. Web Design)"
                          value={item.description}
                          onChange={(e) => updateQuoteItem(index, 'description', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="w-20">
                        <input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => updateQuoteItem(index, 'quantity', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="w-24">
                        <input
                          type="number"
                          placeholder="Price"
                          value={item.price}
                          onChange={(e) => updateQuoteItem(index, 'price', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <button 
                        onClick={() => removeQuoteItem(index)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end items-center pt-4 border-t border-gray-200 mt-4">
                <span className="text-gray-600 mr-2">Total Estimate:</span>
                <span className="text-xl font-bold text-gray-900">${calculateTotal().toFixed(2)}</span>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button 
                  onClick={handleSubmit} 
                  className="px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg font-semibold hover:shadow-lg transition-all"
                >
                  Save Quote Details
                </button>
              </div>
            </div>
          )}

          {lead && activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none resize-none text-gray-900"
                  rows="3"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="mt-3 px-4 py-2 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all disabled:opacity-50"
                >
                  Add Note
                </button>
              </div>

              <div className="space-y-3">
                {lead.notes?.map(note => (
                  <div key={note.id} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                    <p className="text-gray-800 mb-2">{note.text}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(note.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
                {(!lead.notes || lead.notes.length === 0) && (
                  <p className="text-gray-500 text-center py-8">No notes yet</p>
                )}
              </div>
            </div>
          )}

          {lead && activeTab === 'reminders' && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Follow-up Date
                    </label>
                    <input
                      type="date"
                      value={newReminder.date}
                      onChange={(e) => setNewReminder({ ...newReminder, date: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Note
                    </label>
                    <input
                      type="text"
                      value={newReminder.note}
                      onChange={(e) => setNewReminder({ ...newReminder, note: e.target.value })}
                      placeholder="What should you follow up on?"
                      className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                    />
                  </div>
                  <button
                    onClick={handleAddReminder}
                    disabled={!newReminder.date || !newReminder.note}
                    className="px-4 py-2 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all disabled:opacity-50"
                  >
                    Set Reminder
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {lead.reminders?.filter(r => !r.completed).map(reminder => {
                  const isOverdue = new Date(reminder.date) < new Date();
                  return (
                    <div
                      key={reminder.id}
                      className={`rounded-xl p-4 border ${
                        isOverdue
                          ? 'bg-red-50 border-red-200'
                          : 'bg-white border-gray-200 shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className={`font-medium mb-1 ${isOverdue ? 'text-red-700' : 'text-gray-900'}`}>
                            {reminder.note}
                          </p>
                          <p className={`text-sm ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                            {new Date(reminder.date).toLocaleDateString()}
                            {isOverdue && ' (Overdue)'}
                          </p>
                        </div>
                        {isOverdue && (
                          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 ml-3" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onCompleteReminder(lead.id, reminder.id)}
                        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-green-200 bg-white px-3 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-50"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Mark complete
                      </button>
                    </div>
                  );
                })}
                {(!lead.reminders || lead.reminders.filter(r => !r.completed).length === 0) && (
                  <p className="text-gray-500 text-center py-8">No active reminders</p>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// Meeting Modal Component
function MeetingModal({ meeting, leads, onClose, onSave }) {
  useModalBehavior(onClose);
  const [formData, setFormData] = useState({
    title: '',
    leadId: '',
    dateTime: '',
    notes: ''
  });

  // Populate form if editing existing meeting
  useEffect(() => {
    if (meeting) {
      setFormData({
        title: meeting.title || '',
        leadId: meeting.leadId || '',
        dateTime: meeting.dateTime || '',
        notes: meeting.notes || ''
      });
    } else {
      setFormData({
        title: '',
        leadId: '',
        dateTime: '',
        notes: ''
      });
    }
  }, [meeting]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl border border-gray-200 w-full max-w-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-modal-title"
        tabIndex="-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 id="meeting-modal-title" className="text-2xl font-bold text-gray-900">
            {meeting ? 'Edit Meeting' : 'Schedule Meeting'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close meeting dialog"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Meeting Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Product Demo, Follow-up Call"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Lead/Client *
            </label>
            <select
              value={formData.leadId}
              onChange={(e) => setFormData({ ...formData, leadId: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
              required
            >
              <option value="">Select a lead...</option>
              {leads.map(lead => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} {lead.company ? `(${lead.company})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date & Time *
            </label>
            <input
              type="datetime-local"
              value={formData.dateTime}
              onChange={(e) => setFormData({ ...formData, dateTime: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Add any additional notes or agenda items..."
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none resize-none text-gray-900"
              rows="4"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
            >
              {meeting ? 'Update Meeting' : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ============================================
// INVOICE MANAGEMENT COMPONENTS
// ============================================

// Invoice Status Badge Component
function InvoiceStatusBadge({ status }) {
  const statusConfig = {
    draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-700', icon: Edit2 },
    sent: { label: 'Sent', bg: 'bg-blue-50', text: 'text-blue-700', icon: Send },
    paid: { label: 'Paid', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
    overdue: { label: 'Overdue', bg: 'bg-red-50', text: 'text-red-700', icon: AlertCircle },
    partial: { label: 'Partial', bg: 'bg-orange-50', text: 'text-orange-700', icon: DollarSign },
    cancelled: { label: 'Cancelled', bg: 'bg-gray-100', text: 'text-gray-500', icon: X }
  };

  const config = statusConfig[status] || statusConfig.draft;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

// Generate Invoice PDF
async function generateInvoicePDF(invoice, customer) {
  const { jsPDF, autoTable } = await loadPdfLibraries();
  const doc = new jsPDF();
  
  const brandColor = [99, 102, 241];
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...brandColor);
  doc.text("INVOICE", 14, 25);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text("CRM Pro Inc.", 14, 35);
  doc.text("123 Business Ave, Suite 100", 14, 40);
  doc.text("support@crmpro.com", 14, 45);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text(`Invoice #: ${invoice.invoice_number}`, 140, 25);
  
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${new Date(invoice.invoice_date).toLocaleDateString()}`, 140, 30);
  doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString()}`, 140, 35);
  
  const statusText = invoice.status.toUpperCase();
  doc.setFontSize(9);
  doc.setTextColor(...brandColor);
  doc.text(statusText, 140, 42);
  
  doc.setDrawColor(230);
  doc.line(14, 52, 196, 52);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("Bill To:", 14, 62);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(50);
  doc.text(customer.name, 14, 68);
  if (customer.company) doc.text(customer.company, 14, 73);
  doc.text(customer.email, 14, 78);
  if (customer.phone) doc.text(customer.phone, 14, 83);
  
  const items = invoice.items || [];
  const tableColumn = ["Description", "Qty", "Rate", "Amount"];
  const tableRows = items.map(item => [
    item.description || "",
    item.quantity?.toString() || "0",
    `$${parseFloat(item.rate || 0).toFixed(2)}`,
    `$${parseFloat(item.amount || 0).toFixed(2)}`
  ]);
  
  autoTable(doc, {
    startY: 95,
    head: [tableColumn],
    body: tableRows,
    theme: 'striped',
    headStyles: {
      fillColor: brandColor,
      textColor: 255,
      fontSize: 10,
      fontStyle: 'bold'
    },
    bodyStyles: {
      fontSize: 9,
      textColor: 50
    },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
    }
  });
  
  const finalY = doc.lastAutoTable.finalY + 10;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Subtotal:", 140, finalY);
  doc.text(`$${parseFloat(invoice.subtotal || 0).toFixed(2)}`, 196, finalY, { align: 'right' });
  
  if (invoice.discount_amount > 0) {
    doc.text("Discount:", 140, finalY + 6);
    doc.text(`-$${parseFloat(invoice.discount_amount || 0).toFixed(2)}`, 196, finalY + 6, { align: 'right' });
  }
  
  doc.text(`Tax (${invoice.tax_rate || 0}%):`, 140, finalY + 12);
  doc.text(`$${parseFloat(invoice.tax_amount || 0).toFixed(2)}`, 196, finalY + 12, { align: 'right' });
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setDrawColor(...brandColor);
  doc.setLineWidth(0.5);
  doc.line(140, finalY + 16, 196, finalY + 16);
  
  doc.text("TOTAL:", 140, finalY + 23);
  doc.text(`$${parseFloat(invoice.total_amount || 0).toFixed(2)}`, 196, finalY + 23, { align: 'right' });
  
  if (invoice.amount_paid > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Amount Paid:", 140, finalY + 30);
    doc.text(`$${parseFloat(invoice.amount_paid || 0).toFixed(2)}`, 196, finalY + 30, { align: 'right' });
    
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 38, 38);
    doc.text("Balance Due:", 140, finalY + 36);
    doc.text(`$${parseFloat(invoice.balance_due || 0).toFixed(2)}`, 196, finalY + 36, { align: 'right' });
  }
  
  if (invoice.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Notes:", 14, finalY + 35);
    doc.text(invoice.notes, 14, finalY + 40, { maxWidth: 180 });
  }
  
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(150);
  const footerY = 280;
  doc.text("Thank you for your business!", 105, footerY, { align: 'center' });
  doc.text(invoice.terms || "Payment is due within 30 days", 105, footerY + 4, { align: 'center' });
  
  doc.save(`Invoice_${invoice.invoice_number}.pdf`);
}

// Email Invoice Function using Vercel Serverless Function
async function sendInvoiceEmail(invoice, customer, getToken) {
  try {
    const { jsPDF, autoTable } = await loadPdfLibraries();
    // Generate PDF as base64
    const doc = new jsPDF();
    const brandColor = [99, 102, 241];
    
    // Same PDF generation logic
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(...brandColor);
    doc.text("INVOICE", 14, 25);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("CRM Pro Inc.", 14, 35);
    doc.text("123 Business Ave, Suite 100", 14, 40);
    doc.text("support@crmpro.com", 14, 45);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Invoice #: ${invoice.invoice_number}`, 140, 25);
    
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${new Date(invoice.invoice_date).toLocaleDateString()}`, 140, 30);
    doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString()}`, 140, 35);
    
    const statusText = invoice.status.toUpperCase();
    doc.setFontSize(9);
    doc.setTextColor(...brandColor);
    doc.text(statusText, 140, 42);
    
    doc.setDrawColor(230);
    doc.line(14, 52, 196, 52);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text("Bill To:", 14, 62);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(50);
    doc.text(customer.name, 14, 68);
    if (customer.company) doc.text(customer.company, 14, 73);
    doc.text(customer.email, 14, 78);
    if (customer.phone) doc.text(customer.phone, 14, 83);
    
    const items = invoice.items || [];
    const tableColumn = ["Description", "Qty", "Rate", "Amount"];
    const tableRows = items.map(item => [
      item.description || "",
      item.quantity?.toString() || "0",
      `$${parseFloat(item.rate || 0).toFixed(2)}`,
      `$${parseFloat(item.amount || 0).toFixed(2)}`
    ]);
    
    autoTable(doc, {
      startY: 95,
      head: [tableColumn],
      body: tableRows,
      theme: 'striped',
      headStyles: {
        fillColor: brandColor,
        textColor: 255,
        fontSize: 10,
        fontStyle: 'bold'
      },
      bodyStyles: {
        fontSize: 9,
        textColor: 50
      },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 20, halign: 'center' },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
      }
    });
    
    const finalY = doc.lastAutoTable.finalY + 10;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Subtotal:", 140, finalY);
    doc.text(`$${parseFloat(invoice.subtotal || 0).toFixed(2)}`, 196, finalY, { align: 'right' });
    
    if (invoice.discount_amount > 0) {
      doc.text("Discount:", 140, finalY + 6);
      doc.text(`-$${parseFloat(invoice.discount_amount || 0).toFixed(2)}`, 196, finalY + 6, { align: 'right' });
    }
    
    doc.text(`Tax (${invoice.tax_rate || 0}%):`, 140, finalY + 12);
    doc.text(`$${parseFloat(invoice.tax_amount || 0).toFixed(2)}`, 196, finalY + 12, { align: 'right' });
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setDrawColor(...brandColor);
    doc.setLineWidth(0.5);
    doc.line(140, finalY + 16, 196, finalY + 16);
    
    doc.text("TOTAL:", 140, finalY + 23);
    doc.text(`$${parseFloat(invoice.total_amount || 0).toFixed(2)}`, 196, finalY + 23, { align: 'right' });
    
    if (invoice.amount_paid > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Amount Paid:", 140, finalY + 30);
      doc.text(`$${parseFloat(invoice.amount_paid || 0).toFixed(2)}`, 196, finalY + 30, { align: 'right' });
      
      doc.setFont("helvetica", "bold");
      doc.setTextColor(220, 38, 38);
      doc.text("Balance Due:", 140, finalY + 36);
      doc.text(`$${parseFloat(invoice.balance_due || 0).toFixed(2)}`, 196, finalY + 36, { align: 'right' });
    }
    
    if (invoice.notes) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text("Notes:", 14, finalY + 35);
      doc.text(invoice.notes, 14, finalY + 40, { maxWidth: 180 });
    }
    
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(150);
    const footerY = 280;
    doc.text("Thank you for your business!", 105, footerY, { align: 'center' });
    doc.text(invoice.terms || "Payment is due within 30 days", 105, footerY + 4, { align: 'center' });
    
    // Get PDF as base64
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    
    // Get auth session for authentication
    const token = await getToken();
    
    const res = await fetch('/api/send-invoice-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ invoiceId: invoice.id, pdfBase64 })
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to send email');
    }
    const data = await res.json();

    return data;
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw error;
  }
}
// Invoices Page Component
function InvoicesPage({ invoices, customers, onCreateInvoice, onEditInvoice, onDeleteInvoice, onRequestConfirm, onSendInvoice, onNotify }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(null); // Track which invoice is being emailed

  // Handle sending invoice email
  const handleSendEmail = async (invoice, customer) => {
    if (!customer || !customer.email) {
      onNotify('Customer email not found.', 'error');
      return;
    }

    setSendingEmail(invoice.id);
    try {
      await onSendInvoice(invoice, customer);
      onNotify(`Invoice sent successfully to ${customer.email}.`);
    } catch (error) {
      onNotify(`Failed to send email: ${error.message}`, 'error');
    } finally {
      setSendingEmail(null);
    }
  };

  const filteredInvoices = invoices.filter(invoice => {
    const customer = customers.find(c => c.id === invoice.customer_id);
    const matchesSearch = 
      invoice.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer?.company?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Calculate stats
  const stats = {
    total: invoices.length,
    draft: invoices.filter(i => i.status === 'draft').length,
    sent: invoices.filter(i => i.status === 'sent').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
    totalRevenue: invoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0),
    outstanding: invoices
      .filter(i => ['sent', 'overdue', 'partial'].includes(i.status))
      .reduce((sum, i) => sum + parseFloat(i.balance_due || 0), 0)
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <PageHeader
        title="Invoices"
        description="Manage and track your invoices."
        actions={<CRMButton onClick={onCreateInvoice}>
          <Plus className="w-5 h-5" />
          Create Invoice
        </CRMButton>}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          whileHover={{ y: -5 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.total}</h3>
          <p className="text-gray-600 text-sm">Total Invoices</p>
        </motion.div>

        <motion.div
          whileHover={{ y: -5 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <h3 className="text-3xl font-bold text-gray-900 mb-1">
            ${stats.totalRevenue.toLocaleString()}
          </h3>
          <p className="text-gray-600 text-sm">Total Revenue</p>
        </motion.div>

        <motion.div
          whileHover={{ y: -5 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
          </div>
          <h3 className="text-3xl font-bold text-gray-900 mb-1">
            ${stats.outstanding.toLocaleString()}
          </h3>
          <p className="text-gray-600 text-sm">Outstanding</p>
        </motion.div>

        <motion.div
          whileHover={{ y: -5 }}
          className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
          <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.overdue}</h3>
          <p className="text-gray-600 text-sm">Overdue</p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="px-4 py-3 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <Filter className="w-5 h-5" />
            <span>Filter</span>
          </button>

          {showFilterMenu && (
            <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 py-2 min-w-[180px] z-10">
              {['all', 'draft', 'sent', 'paid', 'overdue', 'partial'].map(status => (
                <button
                  key={status}
                  onClick={() => {
                    setStatusFilter(status);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors ${
                    statusFilter === status ? 'text-[#6366F1] font-semibold' : 'text-gray-700'
                  }`}
                >
                  {status === 'all' ? 'All Invoices' : status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => {
            const dataStr = JSON.stringify(filteredInvoices, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `invoices_${Date.now()}.json`;
            link.click();
          }}
          className="px-4 py-3 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all flex items-center gap-2"
        >
          <Download className="w-5 h-5" />
          <span>Export</span>
        </button>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Invoice #</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Customer</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Date</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Due Date</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Amount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No invoices found</p>
                    <button
                      onClick={onCreateInvoice}
                      className="mt-3 text-[#6366F1] hover:text-[#8B5CF6] font-medium text-sm"
                    >
                      Create your first invoice
                    </button>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(invoice => {
                  const customer = customers.find(c => c.id === invoice.customer_id);
                  const isOverdue = new Date(invoice.due_date) < new Date() && invoice.status !== 'paid';
                  const canDelete = invoice.status === 'draft' && Number(invoice.amount_paid || 0) === 0;
                  
                  return (
                    <motion.tr
                      key={invoice.id}
                      whileHover={{ backgroundColor: '#F9FAFB' }}
                      className="cursor-pointer"
                      onClick={() => onEditInvoice(invoice)}
                    >
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">{invoice.invoice_number}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{customer?.name || 'Unknown'}</p>
                          {customer?.company && (
                            <p className="text-sm text-gray-500">{customer.company}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {new Date(invoice.invoice_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {new Date(invoice.due_date).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-gray-900">
                            ${parseFloat(invoice.total_amount || 0).toLocaleString()}
                          </p>
                          {invoice.balance_due > 0 && (
                            <p className="text-xs text-red-600">
                              ${parseFloat(invoice.balance_due).toLocaleString()} due
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <InvoiceStatusBadge status={isOverdue && invoice.status === 'sent' ? 'overdue' : invoice.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void generateInvoicePDF(invoice, customer);
                            }}
                            className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                            title="Download PDF"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendEmail(invoice, customer);
                            }}
                            disabled={sendingEmail === invoice.id}
                            className="p-2 hover:bg-green-50 rounded-lg transition-colors text-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Send via Email"
                          >
                            {sendingEmail === invoice.id ? (
                              <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditInvoice(invoice);
                            }}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canDelete) return;
                              void onRequestConfirm({
                                title: 'Delete this invoice?',
                                description: `Delete ${invoice.invoice_number}? This action cannot be undone.`,
                                confirmLabel: 'Delete invoice',
                              }).then(confirmed => {
                                if (confirmed) onDeleteInvoice(invoice.id);
                              });
                            }}
                            disabled={!canDelete}
                            className="p-2 rounded-lg text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                            title={canDelete ? 'Delete draft invoice' : 'Sent, paid, or cancelled invoices cannot be deleted'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </motion.div>
  );
}

// Export components
export { InvoicesPage, InvoiceStatusBadge, generateInvoicePDF };
function InvoiceModal({ invoice, customers, onClose, onSave }) {
  useModalBehavior(onClose);
  const [formData, setFormData] = useState({
    customer_id: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'draft',
    items: [{ description: '', quantity: 1, rate: 0, amount: 0 }],
    tax_rate: 10,
    discount_amount: 0,
    notes: '',
    terms: 'Payment is due within 30 days'
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (invoice) {
      setFormData({
        customer_id: invoice.customer_id || '',
        invoice_date: invoice.invoice_date || new Date().toISOString().split('T')[0],
        due_date: invoice.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: invoice.status || 'draft',
        items: invoice.items || [{ description: '', quantity: 1, rate: 0, amount: 0 }],
        tax_rate: invoice.tax_rate ?? 10,
        discount_amount: invoice.discount_amount || 0,
        notes: invoice.notes || '',
        terms: invoice.terms || 'Payment is due within 30 days'
      });
    }
  }, [invoice]);

  // Calculate totals
  const calculateTotals = () => {
    const subtotal = formData.items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const taxAmount = (subtotal * parseFloat(formData.tax_rate || 0)) / 100;
    const discountAmount = parseFloat(formData.discount_amount || 0);
    const total = subtotal + taxAmount - discountAmount;

    return {
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2)
    };
  };

  const totals = calculateTotals();

  // Add new line item
  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { description: '', quantity: 1, rate: 0, amount: 0 }]
    });
  };

  // Remove line item
  const removeItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  // Update line item
  const updateItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;

    // Auto-calculate amount when quantity or rate changes
    if (field === 'quantity' || field === 'rate') {
      const quantity = parseFloat(newItems[index].quantity || 0);
      const rate = parseFloat(newItems[index].rate || 0);
      newItems[index].amount = (quantity * rate).toFixed(2);
    }

    setFormData({ ...formData, items: newItems });
  };

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (!formData.customer_id) {
      newErrors.customer_id = 'Please select a customer';
    }

    if (formData.items.length === 0) {
      newErrors.items = 'Please add at least one item';
    }

    if (formData.items.some(item => !item.description)) {
      newErrors.items = 'All items must have a description';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const invoiceData = {
      ...formData,
      subtotal: parseFloat(totals.subtotal),
      tax_amount: parseFloat(totals.taxAmount),
      total_amount: parseFloat(totals.total),
    };

    onSave(invoiceData);
  };

  const selectedCustomer = customers.find(c => c.id === formData.customer_id);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl shadow-2xl max-h-[95vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-modal-title"
        tabIndex="-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 id="invoice-modal-title" className="text-xl font-bold text-gray-900">
                {invoice ? 'Edit Invoice' : 'Create New Invoice'}
              </h2>
              <p className="text-xs text-gray-500">Fill in the details below</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invoice dialog"
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
          {/* Customer & Date Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Customer Selection */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Customer *
              </label>
              <select
                value={formData.customer_id}
                onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
                className={`w-full px-3 py-2 bg-gray-50 border rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900 text-sm ${
                  errors.customer_id ? 'border-red-300' : 'border-gray-300'
                }`}
                required
              >
                <option value="">Select a customer...</option>
                {customers.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} {customer.company ? `(${customer.company})` : ''} {!customer.isCustomer ? '- Lead' : ''}
                  </option>
                ))}
              </select>
              {errors.customer_id && (
                <p className="mt-1 text-xs text-red-600">{errors.customer_id}</p>
              )}
            </div>

            {/* Invoice Date */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Invoice Date *
              </label>
              <input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900 text-sm"
                required
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Due Date *
              </label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900 text-sm"
                required
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900 text-sm"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="partial">Partially Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Line Items */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">Items</h3>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-all text-gray-700"
              >
                <Plus className="w-3 h-3" />
                Add Item
              </button>
            </div>

            {errors.items && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                {errors.items}
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {formData.items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-start p-2 bg-gray-50 rounded-lg">
                  {/* Description */}
                  <div className="col-span-5">
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Description</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(index, 'description', e.target.value)}
                      placeholder="Item description"
                      className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                      required
                    />
                  </div>

                  {/* Quantity */}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Qty</label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      min="0"
                      step="1"
                      className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                      required
                    />
                  </div>

                  {/* Rate */}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Rate ($)</label>
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(index, 'rate', parseFloat(e.target.value) || 0)}
                      min="0"
                      step="0.01"
                      className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#6366F1] focus:border-transparent outline-none text-gray-900"
                      required
                    />
                  </div>

                  {/* Amount */}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                    <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-gray-900 font-semibold text-sm">
                      ${parseFloat(item.amount || 0).toFixed(2)}
                    </div>
                  </div>

                  {/* Remove Button */}
                  <div className="col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={formData.items.length === 1}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals Section */}
          <div className="border-t border-gray-200 pt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Left: Notes and Terms */}
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Add any additional notes..."
                    className="w-full px-2 py-1.5 bg-gray-50 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#6366F1] focus:border-transparent outline-none resize-none text-gray-900"
                    rows="2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Terms & Conditions
                  </label>
                  <textarea
                    value={formData.terms}
                    onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                    placeholder="Payment terms..."
                    className="w-full px-2 py-1.5 bg-gray-50 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#6366F1] focus:border-transparent outline-none resize-none text-gray-900"
                    rows="2"
                  />
                </div>
              </div>

              {/* Right: Calculations */}
              <div className="space-y-2">
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">Subtotal:</span>
                    <span className="font-semibold text-gray-900">${totals.subtotal}</span>
                  </div>

                  {/* Tax */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-700">Tax:</span>
                      <input
                        type="number"
                        value={formData.tax_rate}
                        onChange={(e) => setFormData({ ...formData, tax_rate: parseFloat(e.target.value) || 0 })}
                        min="0"
                        max="100"
                        step="0.1"
                        className="w-12 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs text-gray-900"
                      />
                      <span className="text-gray-600 text-xs">%</span>
                    </div>
                    <span className="font-semibold text-gray-900">${totals.taxAmount}</span>
                  </div>

                  {/* Discount */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">Discount ($):</span>
                    <input
                      type="number"
                      value={formData.discount_amount}
                      onChange={(e) => setFormData({ ...formData, discount_amount: parseFloat(e.target.value) || 0 })}
                      min="0"
                      step="0.01"
                      className="w-20 px-2 py-0.5 bg-white border border-gray-300 rounded text-xs text-gray-900 text-right"
                    />
                  </div>

                  {/* Total */}
                  <div className="pt-2 border-t border-gray-300">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold text-gray-900">Total:</span>
                      <span className="text-xl font-bold text-[#6366F1]">${totals.total}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions - Sticky Footer */}
          <div className="sticky bottom-0 bg-white flex justify-end gap-2 px-6 py-3 border-t border-gray-200 rounded-b-xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-gray-700 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
            >
              {invoice ? 'Update Invoice' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

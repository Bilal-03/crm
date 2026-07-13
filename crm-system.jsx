import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, 
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area 
} from 'recharts';
import { 
  Home, Users, Target, Calendar, FileText, LogOut, Plus, 
  Search, Filter, Download, X, Edit2, Trash2, Save, ChevronLeft,
  Mail, Phone, Building2, Clock, AlertCircle, CheckCircle2,
  LayoutGrid, List, Menu, User, Bell, TrendingUp, Activity,
  Flame, Sun, Snowflake, FileDown, DollarSign, Send, Eye, Printer
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

import { useAuth, useUser, SignIn, SignUp } from '@clerk/clerk-react';

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
    row.map(cell => `"${cell}"`).join(',')
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
const generateQuotePDF = (lead) => {
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

  doc.save(`Quote_Q-${Math.floor(Math.random() * 10000)}_${lead.name.replace(/\s+/g, '_')}.pdf`);
};

// Main App Component
export default function CRMApp() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);

  const fetchApi = async (endpoint, options = {}) => {
    const token = await getToken();
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(await res.text());
    if (res.status !== 204) return res.json();
    return null;
  };

  const [currentPage, setCurrentPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Data states
  const [leads, setLeads] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [activities, setActivities] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  
  // UI states
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [pipelineView, setPipelineView] = useState('kanban'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStage, setFilterStage] = useState('all');

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
  }, [user]);

  // Update customers when leads change
  useEffect(() => {
    if (user && leads.length > 0) {
      fetchCustomers(user.id);
    }
  }, [leads, user]);

  // 2. Fetch Data Helper (With Data Mapping)
  const fetchData = async (userId) => {
    setLoading(true);
    try {
      const [leadsRes, meetingsRes, activitiesRes] = await Promise.all([
        fetchApi('/leads'),
        fetchApi('/meetings'),
        fetchApi('/activities?limit=50')
      ]);

      if (leadsRes.data) {
        // Map DB snake_case to Frontend camelCase
        const mappedLeads = leadsRes.data.map(l => ({
          ...l,
          createdAt: l.created_at,
          quoteItems: l.quote_items || []
        }));
        setLeads(mappedLeads);
      }

      if (meetingsRes.data) {
        const mappedMeetings = meetingsRes.data.map(m => ({
          ...m,
          dateTime: m.date_time,
          leadId: m.lead_id,
          createdAt: m.created_at
        }));
        setMeetings(mappedMeetings);
      }

      if (activitiesRes.data) {
        setActivities(activitiesRes.data);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch invoices
  const fetchInvoices = async (userId) => {
    try {
      let data;
      let error = null;
      try {
        data = await fetchApi('/invoices');
      } catch (e) {
        error = e;
      }
      
      if (data) setInvoices(data);
      if (error) console.error('Error fetching invoices:', error);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  };

  // Fetch customers
  const fetchCustomers = async (userId) => {
    try {
      // Fetch actual customers from customers table
      const customersData = await fetchApi('/customers');
      const customersError = null;
      
      console.log('Fetched customers from DB:', customersData);
      console.log('Local leads state:', leads);

      // Combine both into customers list
      const allCustomers = [];
      
      // Add actual customers first
      if (customersData && customersData.length > 0) {
        allCustomers.push(...customersData.map(c => ({
          ...c,
          isCustomer: true
        })));
      }
      
      // Add ALL leads from local state (not from database)
      if (leads && leads.length > 0) {
        const existingCustomerEmails = customersData?.map(c => c.email) || [];
        const leadsAsCustomers = leads
          .filter(lead => !existingCustomerEmails.includes(lead.email))
          .map(lead => ({
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            company: lead.company,
            isCustomer: false // Mark as lead
          }));
        allCustomers.push(...leadsAsCustomers);
      }
      
      console.log('All customers/leads combined:', allCustomers);
      setCustomers(allCustomers);
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
      newCustomer = await fetchApi('/customers', { method: 'POST', body: JSON.stringify({
        user_id: user.id,
        name: selectedItem.name,
        email: selectedItem.email,
        phone: selectedItem.phone,
        company: selectedItem.company,
        created_at: new Date().toISOString()
      }) });
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error('Error creating customer from lead:', error);
      throw new Error(`Failed to create customer: ${error.message}`);
    }

    // Refresh customers list
    await fetchCustomers(user.id);
    
    return newCustomer.id;
  };

 // --- CRUD OPERATIONS ---

  // Add Activity
  const addActivity = async (type, message, leadId = null) => {
    const newActivity = {
      id: crypto.randomUUID(), // FIXED: Generate ID
      type,
      message,
      lead_id: leadId,
      user_id: user.id
    };
    
    let data; let error = null; try { data = await fetchApi('/activities', { method: 'POST', body: JSON.stringify(newActivity) }); } catch (e) { error = e; }
    
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
      id: crypto.randomUUID(), // FIXED: Generate ID
      ...rest,
      user_id: user.id,
      stage: leadData.stage || 'new',
      quote_items: quoteItems || [],
      notes: [],
      reminders: []
    };

    console.log("Attempting to add lead:", dbLead); // Debug log

    let data; let error = null; try { data = await fetchApi('/leads', { method: 'POST', body: JSON.stringify(dbLead) }); } catch (e) { error = e; }

    if (error) {
      console.error('Error adding lead:', error);
      alert('Failed to add lead. Check console for details.');
      return;
    }

    if (data) {
      const newLead = {
        ...data,
        createdAt: data.created_at,
        quoteItems: data.quote_items
      };
      setLeads(prev => [newLead, ...prev]);
      addActivity('lead_created', `New lead added: ${leadData.name}`);
    }
  };

  const updateLead = async (leadId, updates) => {
    const dbUpdates = { ...updates };
    if (updates.quoteItems) {
      dbUpdates.quote_items = updates.quoteItems;
      delete dbUpdates.quoteItems;
    }

    let data; let error = null; try { data = await fetchApi(`/leads?id=${ leadId }`, { method: 'PUT', body: JSON.stringify(dbUpdates) }); } catch (e) { error = e; }

    if (error) {
      console.error('Error updating lead:', error);
      return;
    }

    if (data) {
      setLeads(prev => prev.map(lead => 
        lead.id === leadId ? { ...lead, ...updates, quoteItems: data.quote_items } : lead
      ));
      addActivity('lead_updated', `Lead updated`, leadId);
    }
  };

  const deleteLead = async (leadId) => {
    // Optimistic update
    setLeads(prev => prev.filter(l => l.id !== leadId));
    
    let error = null; try { await fetchApi(`/leads?id=${ leadId }`, { method: 'DELETE' }); } catch (e) { error = e; }
    
    if (error) {
      console.error('Error deleting lead:', error);
      // Revert if needed, or alert user
    } else {
      addActivity('lead_deleted', 'Lead deleted');
    }
  };

  const addNote = async (leadId, noteText) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const newNote = {
      id: crypto.randomUUID(),
      text: noteText,
      timestamp: new Date().toISOString()
    };

    const updatedNotes = [newNote, ...(lead.notes || [])];
    
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, notes: updatedNotes } : l));
    
    let error = null; try { await fetchApi(`/leads?id=${ leadId }`, { method: 'PUT', body: JSON.stringify({ notes: updatedNotes }) }); } catch (e) { error = e; }
    if (error) console.error('Error adding note:', error);
    else addActivity('note_added', `Note added to lead`, leadId);
  };

  const addReminder = async (leadId, reminderData) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const newReminder = {
      id: crypto.randomUUID(),
      ...reminderData,
      createdAt: new Date().toISOString(),
      completed: false
    };

    const updatedReminders = [...(lead.reminders || []), newReminder];

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, reminders: updatedReminders } : l));
    
    let error = null; try { await fetchApi(`/leads?id=${ leadId }`, { method: 'PUT', body: JSON.stringify({ reminders: updatedReminders }) }); } catch (e) { error = e; }
    if (error) console.error('Error adding reminder:', error);
    else addActivity('reminder_set', `Follow-up reminder set`, leadId);
  };

  // 4. Meeting Operations
  const addMeeting = async (meetingData) => {
    const dbMeeting = {
      id: crypto.randomUUID(), // FIXED: Generate ID
      user_id: user.id,
      lead_id: meetingData.leadId,
      title: meetingData.title,
      date_time: meetingData.dateTime,
      notes: meetingData.notes
    };

    let data; let error = null; try { data = await fetchApi('/meetings', { method: 'POST', body: JSON.stringify(dbMeeting) }); } catch (e) { error = e; }

    if (error) {
      console.error('Error adding meeting:', error);
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
      addActivity('meeting_scheduled', `Meeting scheduled: ${meetingData.title}`, meetingData.leadId);
    }
  };

  const updateMeeting = async (meetingId, updates) => {
    const dbUpdates = { ...updates };
    if (updates.dateTime) {
      dbUpdates.date_time = updates.dateTime;
      delete dbUpdates.dateTime;
    }
    
    let error = null; try { await fetchApi(`/meetings?id=${ meetingId }`, { method: 'PUT', body: JSON.stringify(dbUpdates) }); } catch (e) { error = e; }
    
    if (error) {
      console.error('Error updating meeting:', error);
    } else {
      setMeetings(prev => prev.map(meeting => 
        meeting.id === meetingId ? { ...meeting, ...updates } : meeting
      ));
      addActivity('meeting_updated', `Meeting updated`, updates.leadId);
    }
  };

  const deleteMeeting = async (meetingId) => {
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
    let error = null; try { await fetchApi(`/meetings?id=${ meetingId }`, { method: 'DELETE' }); } catch (e) { error = e; }
    if (error) console.error('Error deleting meeting:', error);
    else addActivity('meeting_deleted', `Meeting deleted`);
  };

  // Invoice Operations
  const generateInvoiceNumber = () => {
    const prefix = 'INV';
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}-${random}`;
  };

  const addInvoice = async (invoiceData) => {
    try {
      // First, ensure the customer exists in the customers table
      const validCustomerId = await ensureCustomerExists(invoiceData.customer_id);
      
      const newInvoice = {
        ...invoiceData,
        customer_id: validCustomerId,
        invoice_number: generateInvoiceNumber(),
        user_id: user.id
      };

      console.log('Creating invoice with data:', newInvoice); // Debug log

      let data;
      let error = null;
      try {
        data = await fetchApi('/invoices', { method: 'POST', body: JSON.stringify([newInvoice][0]) });
      } catch (e) {
        error = e;
      }

      if (error) {
        console.error('Error creating invoice:', error);
        alert(`Failed to create invoice: ${error.message || 'Unknown error'}`);
        return;
      }

      if (data) {
        setInvoices(prev => [data, ...prev]);
        setShowInvoiceModal(false);
        setSelectedInvoice(null);
        addActivity('invoice_created', `Invoice ${data.invoice_number} created`);
        alert('Invoice created successfully!');
      }
    } catch (err) {
      console.error('Exception creating invoice:', err);
      alert(`Failed to create invoice: ${err.message}`);
    }
  };

  const updateInvoice = async (invoiceId, invoiceData) => {
    let data;
    let error = null;
    try {
      data = await fetchApi(`/invoices?id=${invoiceId}`, { method: 'PUT', body: JSON.stringify(invoiceData) });
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error('Error updating invoice:', error);
      alert('Failed to update invoice');
      return;
    }

    if (data) {
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? data : inv));
      setShowInvoiceModal(false);
      setSelectedInvoice(null);
      addActivity('invoice_updated', `Invoice ${data.invoice_number} updated`);
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
      alert('Failed to delete invoice');
      return;
    }

    setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
    addActivity('invoice_deleted', `Invoice ${invoice?.invoice_number} deleted`);
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
      await fetchApi(`/leads?id=${ draggableId }`, { method: 'PUT', body: JSON.stringify({ stage: destination.droppableId }) });
      
      addActivity('stage_changed', `${lead?.name} moved to ${PIPELINE_STAGES.find(s => s.id === destination.droppableId)?.label}`, draggableId);
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
    totalLeads: leads.length,
    newLeads: leads.filter(l => l.stage === 'new').length,
    qualified: leads.filter(l => l.stage === 'qualified').length,
    proposals: leads.filter(l => l.stage === 'proposal').length,
    closedWon: leads.filter(l => l.stage === 'closed-won').length,
    upcomingMeetings: meetings.filter(m => new Date(m.dateTime).getTime() > new Date().getTime()).length,
    overdueReminders: leads.reduce((count, lead) => {
      return count + (lead.reminders || []).filter(r => 
        new Date(r.date) < new Date() && !r.completed
      ).length;
    }, 0)
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#6366F1]"></div>
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

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <Sidebar 
        open={sidebarOpen}
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        user={user}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header 
          user={user}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          overdueCount={stats.overdueReminders}
        />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {currentPage === 'dashboard' && (
              <Dashboard 
                stats={stats}
                activities={activities}
                meetings={meetings}
                leads={leads}
                invoices={invoices}
                customers={customers}
                onNavigate={setCurrentPage}
                onAddLead={() => setShowLeadModal(true)}
              />
            )}
            
            {currentPage === 'leads' && (
              <LeadsPage 
                leads={filteredLeads}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filterStage={filterStage}
                setFilterStage={setFilterStage}
                onAddLead={() => setShowLeadModal(true)}
                onEditLead={(lead) => {
                  setSelectedLead(lead);
                  setShowLeadModal(true);
                }}
                onDeleteLead={deleteLead}
                onExport={() => exportToCSV(filteredLeads, 'leads.csv')}
              />
            )}
            
            {currentPage === 'clients' && (
              <ClientsPage 
                clients={clients}
                onViewClient={(lead) => {
                  setSelectedLead(lead);
                  setShowLeadModal(true);
                }}
              />
            )}
            
            {currentPage === 'pipeline' && (
              <PipelinePage 
                leads={filteredLeads}
                view={pipelineView}
                setView={setPipelineView}
                onDragEnd={handleDragEnd}
                onEditLead={(lead) => {
                  setSelectedLead(lead);
                  setShowLeadModal(true);
                }}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
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
              />
            )}

            {currentPage === 'invoices' && (
              <InvoicesPage 
                invoices={invoices}
                customers={customers}
                onCreateInvoice={() => {
                  setSelectedInvoice(null);
                  setShowInvoiceModal(true);
                }}
                onEditInvoice={(invoice) => {
                  setSelectedInvoice(invoice);
                  setShowInvoiceModal(true);
                }}
                onDeleteInvoice={deleteInvoice}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

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
    </div>
  );
}


// Sidebar Component
function Sidebar({ open, currentPage, onNavigate, onToggle, user }) {
  const menuItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard' },
    { id: 'leads', icon: Users, label: 'Leads' },
    { id: 'clients', icon: Target, label: 'Clients' },
    { id: 'pipeline', icon: Activity, label: 'Pipeline' },
    { id: 'invoices', icon: FileText, label: 'Invoices' },
    { id: 'meetings', icon: Calendar, label: 'Meetings' }
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 280 : 80 }}
      className="bg-white border-r border-gray-200 flex flex-col relative z-10"
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

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${
              currentPage === item.id
                ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/30'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {open && (
              <span>{item.label}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={() => window.Clerk.signOut()}
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
function Header({ user, onToggleSidebar, overdueCount }) {
  return (
    <header className="bg-white/50 backdrop-blur-xl border-b border-gray-200 px-8 py-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Menu className="w-6 h-6 text-gray-700" />
        </button>

        <div className="flex items-center gap-4">
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-600">{overdueCount} overdue reminders</span>
            </div>
          )}
          
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user.user_metadata?.name || user.email}
              </p>
              <p className="text-xs text-gray-500">
                {user.email}
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

// Dashboard Component
// Dashboard Component
function Dashboard({ stats, activities, meetings, leads, invoices = [], customers = [], onNavigate, onAddLead }) {
  // Prepare Data for Charts
  const pipelineData = PIPELINE_STAGES.map(stage => ({
    name: stage.label,
    count: leads.filter(l => l.stage === stage.id).length,
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
    total: invoices.length,
    paid: invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => {
      if (i.status === 'paid' || i.status === 'cancelled') return false;
      return new Date(i.due_date) < new Date();
    }).length,
    draft: invoices.filter(i => i.status === 'draft').length,
    totalRevenue: invoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0),
    outstanding: invoices
      .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .reduce((sum, i) => sum + parseFloat(i.balance_due || i.total_amount || 0), 0),
    thisMonthRevenue: invoices
      .filter(i => {
        if (i.status !== 'paid') return false;
        const paidDate = new Date(i.paid_at || i.invoice_date);
        const now = new Date();
        return paidDate.getMonth() === now.getMonth() && 
               paidDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0),
  };

  // Revenue Trend (Last 7 days)
  const revenueTrendData = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
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

  // Calculate conversion rate
  const conversionRate = stats.totalLeads > 0 
    ? ((stats.closedWon / stats.totalLeads) * 100).toFixed(1) 
    : 0;

  // Calculate pipeline value
  const pipelineValue = leads
    .filter(l => ['qualified', 'proposal'].includes(l.stage))
    .length * 5000;

  // Calculate average deal size
  const avgDealSize = invoiceStats.paid > 0
    ? (invoiceStats.totalRevenue / invoiceStats.paid)
    : 5000;

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

        {/* Quick Stats in Hero */}
        <div className="grid grid-cols-3 gap-4 mt-6 relative z-10">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <div className="text-white/70 text-sm mb-1">This Month Revenue</div>
            <div className="text-2xl font-bold">${(invoiceStats.thisMonthRevenue / 1000).toFixed(1)}K</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <div className="text-white/70 text-sm mb-1">Conversion Rate</div>
            <div className="text-2xl font-bold">{conversionRate}%</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <div className="text-white/70 text-sm mb-1">Avg. Deal Size</div>
            <div className="text-2xl font-bold">${(avgDealSize / 1000).toFixed(1)}K</div>
          </div>
        </div>
      </div>

      {/* Financial Metrics - New Section */}
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
              <p className="text-sm text-gray-500">Last 7 days performance</p>
            </div>
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-blue-600" />
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
              <span className="text-xs font-semibold px-2 py-1 bg-green-50 text-green-600 rounded-full">
                +12%
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
                +8%
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

// Updated LeadsPage (Now correctly calls the dynamic PDF generator)
function LeadsPage({ 
  leads, 
  searchTerm, 
  setSearchTerm, 
  filterStage, 
  setFilterStage,
  onAddLead,
  onEditLead,
  onDeleteLead,
  onExport
}) {
  // Sort leads by Score (Highest first)
  const sortedLeads = [...leads].sort((a, b) => calculateLeadScore(b) - calculateLeadScore(a));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900">
            Leads
          </h1>
          <p className="text-gray-600">
            AI-Scored leads sorted by priority.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all border bg-white hover:bg-gray-50 border-gray-300 text-gray-700"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={onAddLead}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
          >
            <Plus className="w-5 h-5" />
            Add Lead
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="backdrop-blur-xl rounded-2xl p-6 bg-white border border-gray-200 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>
      </div>

      {/* Leads Table */}
      <div className="backdrop-blur-xl rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
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
              {sortedLeads.map(lead => {
                const stage = PIPELINE_STAGES.find(s => s.id === lead.stage);
                const score = calculateLeadScore(lead);
                const scoreConfig = getScoreConfig(score);
                const ScoreIcon = scoreConfig.icon;

                return (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    {/* Priority Score Column */}
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${scoreConfig.bg} ${scoreConfig.color} border border-${scoreConfig.color}/20`}>
                        <ScoreIcon className="w-3 h-3" />
                        {score} - {scoreConfig.label}
                      </div>
                    </td>
                    
                    {/* Name Column */}
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {lead.name}
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
                          onClick={() => generateQuotePDF(lead)} 
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
                            if (confirm('Are you sure you want to delete this lead?')) {
                              onDeleteLead(lead.id);
                            }
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
    </motion.div>
  );
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900">
            Sales Pipeline
          </h1>
          <p className="text-gray-600">
            Track leads through your sales process
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 rounded-lg focus:ring-2 focus:ring-[#6366F1] focus:border-transparent outline-none w-64 bg-white border border-gray-300 text-gray-900 placeholder-gray-400"
            />
          </div>
          <div className="flex rounded-lg p-1 border bg-white border-gray-300">
            <button
              onClick={() => setView('kanban')}
              className={`px-4 py-2 rounded-md flex items-center gap-2 transition-all ${
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
              className={`px-4 py-2 rounded-md flex items-center gap-2 transition-all ${
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
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <h3 className="font-semibold text-gray-900">
                    {stage.label}
                  </h3>
                  <span className="text-sm text-gray-500">
                    ({stageLeads.length})
                  </span>
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
function MeetingsPage({ meetings, leads, onAddMeeting, onEditMeeting, onDeleteMeeting }) {
  const upcomingMeetings = meetings.filter(m => new Date(m.dateTime) >= new Date());
  const pastMeetings = meetings.filter(m => new Date(m.dateTime) < new Date());

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900">Meetings</h1>
          <p className="text-gray-600">Schedule and track client meetings</p>
        </div>
        <button
          onClick={onAddMeeting}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
        >
          <Plus className="w-5 h-5" />
          Schedule Meeting
        </button>
      </div>

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
                        if (confirm('Are you sure you want to delete this meeting?')) {
                          onDeleteMeeting(meeting.id);
                        }
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
                        if (confirm('Are you sure you want to delete this meeting?')) {
                          onDeleteMeeting(meeting.id);
                        }
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
function LeadModal({ lead, onClose, onSave, onAddNote, onAddReminder }) {
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl border border-gray-200 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {lead ? 'Edit Lead' : 'New Lead'}
          </h2>
          <button
            onClick={onClose}
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
  const [formData, setFormData] = useState({
    title: '',
    leadId: '',
    dateTime: '',
    notes: '',
    syncToGoogleCalendar: true // New field for calendar sync
  });

  const [isGoogleAuthorized, setIsGoogleAuthorized] = useState(false);

  // Check if Google Calendar is authorized
  useEffect(() => {
    const googleToken = localStorage.getItem('google_calendar_token');
    setIsGoogleAuthorized(!!googleToken);
  }, []);

  // Populate form if editing existing meeting
  useEffect(() => {
    if (meeting) {
      setFormData({
        title: meeting.title || '',
        leadId: meeting.leadId || '',
        dateTime: meeting.dateTime || '',
        notes: meeting.notes || '',
        syncToGoogleCalendar: meeting.syncToGoogleCalendar !== false
      });
    } else {
      setFormData({
        title: '',
        leadId: '',
        dateTime: '',
        notes: '',
        syncToGoogleCalendar: true
      });
    }
  }, [meeting]);

  const handleGoogleAuth = () => {
    // Open Google OAuth popup
    const clientId = ''; // User needs to add their Google Client ID here
    if (!clientId) {
      alert('Please add your Google Client ID to enable calendar sync. See GOOGLE-CALENDAR-SETUP.md for instructions.');
      return;
    }
    
    const redirectUri = window.location.origin;
    const scope = 'https://www.googleapis.com/auth/calendar.events';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}`;
    
    window.open(authUrl, 'Google Calendar Authorization', 'width=500,height=600');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl border border-gray-200 w-full max-w-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {meeting ? 'Edit Meeting' : 'Schedule Meeting'}
          </h2>
          <button
            onClick={onClose}
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
function generateInvoicePDF(invoice, customer) {
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

// Email Invoice Function using Supabase Edge Function
async function sendInvoiceEmail(invoice, customer) {
  try {
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
    const token = await window.Clerk?.session?.getToken();
    
    const res = await fetch('/api/send-invoice-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ invoice, customer, pdfBase64 })
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to send email');
    }
    const data = await res.json();

    return data;
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw error;
  }
}
// Invoices Page Component
function InvoicesPage({ invoices, customers, onCreateInvoice, onEditInvoice, onDeleteInvoice }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(null); // Track which invoice is being emailed

  // Handle sending invoice email
  const handleSendEmail = async (invoice, customer) => {
    if (!customer || !customer.email) {
      alert('Customer email not found');
      return;
    }

    setSendingEmail(invoice.id);
    try {
      await sendInvoiceEmail(invoice, customer);
      alert(`Invoice sent successfully to ${customer.email}!`);
    } catch (error) {
      alert(`Failed to send email: ${error.message}`);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-600 mt-1">Manage and track your invoices</p>
        </div>
        <button
          onClick={onCreateInvoice}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-[#6366F1]/50 transition-all"
        >
          <Plus className="w-5 h-5" />
          Create Invoice
        </button>
      </div>

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
                  <td colSpan="7" className="px-6 py-12 text-center">
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
                              generateInvoicePDF(invoice, customer);
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
                              if (confirm('Delete this invoice?')) {
                                onDeleteInvoice(invoice.id);
                              }
                            }}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600"
                            title="Delete"
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
        tax_rate: invoice.tax_rate || 10,
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
      balance_due: parseFloat(totals.total),
      amount_paid: 0
    };

    onSave(invoiceData);
  };

  const selectedCustomer = customers.find(c => c.id === formData.customer_id);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl shadow-2xl max-h-[95vh] flex flex-col"
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {invoice ? 'Edit Invoice' : 'Create New Invoice'}
              </h2>
              <p className="text-xs text-gray-500">Fill in the details below</p>
            </div>
          </div>
          <button
            onClick={onClose}
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
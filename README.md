# 🎯 CRM Pro - AI-Powered Sales Management System

A modern, feature-rich CRM application built with React, Neon & Clerk, and AI-powered lead scoring. Streamline your sales pipeline with intelligent automation, beautiful analytics, and professional quote generation.

![CRM Pro](https://img.shields.io/badge/version-1.0.0-blue.svg)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Neon](https://img.shields.io/badge/Neon-Database-00E599?logo=neon) ![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?logo=clerk)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 🎯 Core CRM Functionality
- **Lead Management** - Track and organize leads with AI-powered priority scoring
- **Pipeline Visualization** - Drag-and-drop Kanban board + table view
- **Client Management** - Manage closed-won clients with full contact history
- **Meeting Scheduler** - Schedule, edit, and track client meetings
- **Activity Tracking** - Automatic activity logging for all actions
- **Notes & Reminders** - Add detailed notes and set follow-up reminders

### 🤖 AI-Powered Features
- **Smart Lead Scoring** - Automatic priority scoring (Hot/Warm/Cold) based on:
  - Contact information completeness
  - Lead source quality
  - Engagement level (notes, interactions)
  - Pipeline stage
- **Visual Score Indicators** - Color-coded badges with 🔥 Hot, ☀️ Warm, ❄️ Cold icons

### 📊 Analytics & Reporting
- **Real-time Dashboard** with:
  - Pipeline distribution bar chart
  - Lead source pie chart
  - 7-day growth trend area chart
  - Key performance metrics
- **Export to CSV** - Download leads data for external analysis
- **Visual Insights** - Recharts-powered interactive charts

### 📄 Professional Quote Builder
- **In-App Quote Generator** - Build itemized quotes with line items
- **PDF Export** - Generate professional PDF quotes with:
  - Company branding
  - Itemized pricing table
  - Terms & conditions
  - Automatic quote numbering
- **Real-time Quote Preview** - See totals as you build

### 🔗 Smart Integrations
- **One-Click Email** - Pre-filled professional email templates
- **Google Calendar Integration** - Add meetings to calendar with one click
- **Automated Reminders** - Never miss a follow-up with overdue alerts

### 🎨 Beautiful UI/UX
- **Light Theme** - Professional, clean interface
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Smooth Animations** - Framer Motion powered transitions
- **Drag & Drop** - Intuitive pipeline management

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Neon & Clerk account (free tier works!)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/Bilal-03/crm.git
cd crm
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up Neon & Clerk**
- Create a new project at [neon.com](https://neon.com)
- Get your Project URL and Anon Key from Project Settings → API
- Update `crm-system.jsx` lines 66-67 with your credentials:

```javascript
const neon = createClient(
  'YOUR_NEON_DATABASE_URL',      // Replace with your Project URL
  'YOUR_CLERK_PUBLISHABLE_KEY'  // Replace with your Anon Key
);
```

4. **Create database tables**

Run these SQL commands in your Neon & Clerk SQL Editor:

```sql
-- Leads table
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT,
  stage TEXT DEFAULT 'new',
  notes JSONB DEFAULT '[]',
  reminders JSONB DEFAULT '[]',
  quote_items JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meetings table
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date_time TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activities table
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own leads" ON leads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own leads" ON leads
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own leads" ON leads
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own leads" ON leads
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own meetings" ON meetings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own meetings" ON meetings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own meetings" ON meetings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own meetings" ON meetings
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own activities" ON activities
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own activities" ON activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

5. **Run the development server**
```bash
npm run dev
```

6. **Open your browser**
Navigate to `http://localhost:5173`

## ☁️ Deployment

The easiest way to deploy this application online is using **Vercel**, which provides built-in support for Vite and React applications.

1. **Push your code to GitHub**
   Make sure all your latest changes are pushed to your GitHub repository.

2. **Deploy to Vercel**
   - Go to [Vercel.com](https://vercel.com) and log in with your GitHub account.
   - Click **Add New** > **Project**.
   - Import your `crm` repository from GitHub.
   - Vercel will automatically detect that it's a Vite project.
   - Leave the default build settings (Build Command: `npm run build`, Output Directory: `dist`).
   - Click **Deploy**.

3. **Configure Environment Variables** (If applicable)
   - If your application uses environment variables (like Neon & Clerk keys) in `.env`, you must add them in Vercel.
   - Go to your Vercel Project Settings > Environment Variables.
   - Add your keys (e.g., `NEON_DATABASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`).
   - Redeploy the project for the variables to take effect.

Your app will be live on a `*.vercel.app` domain and will automatically redeploy whenever you push to the `main` branch!

## 📁 Project Structure

```
crm/
├── src/
│   ├── main.jsx           # React entry point
│   └── index.css          # Tailwind CSS imports
├── crm-system.jsx         # Main application code
├── index.html             # HTML entry point
├── package.json           # Dependencies
├── vite.config.js         # Vite configuration
├── tailwind.config.js     # Tailwind CSS config
├── postcss.config.js      # PostCSS config
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework |
| **Vite** | Build tool & dev server |
| **Neon & Clerk** | Backend (Auth + Database) |
| **Tailwind CSS** | Styling |
| **Framer Motion** | Animations |
| **Recharts** | Data visualization |
| **jsPDF & autoTable** | PDF generation |
| **@hello-pangea/dnd** | Drag and drop |
| **Lucide React** | Icons |

## 🎯 Key Features Explained

### AI Lead Scoring Algorithm

The CRM automatically scores each lead (0-100) based on:
- ✅ Email provided: +10 points
- ✅ Phone provided: +10 points  
- ✅ Company provided: +5 points
- ✅ Premium source (Referral/LinkedIn/Partner): +15 points
- ✅ Each note added: +5 points
- ✅ Qualified stage: +10 points
- ✅ Proposal stage: +20 points

**Score Categories:**
- 🔥 **Hot (60-100)**: High priority, ready to close
- ☀️ **Warm (30-59)**: Engaged, needs nurturing
- ❄️ **Cold (0-29)**: Low engagement, long-term prospect

### Quote Builder Workflow

1. Open any lead in edit mode
2. Click "Quote Builder" tab
3. Add line items (description, quantity, price)
4. Save quote to lead
5. Click PDF icon in leads table to generate professional quote
6. PDF downloads automatically with branding and terms

### Pipeline Stages

- **New Lead** - Just added to system
- **Qualified** - Meets buying criteria
- **Follow-up** - Active conversation
- **Proposal** - Quote sent
- **Closed Won** - Deal closed! ✅
- **Closed Lost** - Opportunity lost

## 📸 Screenshots

### Dashboard
![Dashboard with analytics charts and activity feed]

### Leads Page  
![Sortable leads table with AI scoring and quick actions]

### Pipeline View
![Drag-and-drop Kanban board]

### Quote Builder
![In-app quote builder with PDF export]

## 🔐 Security Features

- ✅ Row Level Security (RLS) enabled on all tables
- ✅ User data isolation (users only see their own data)
- ✅ Secure authentication via Neon & Clerk Auth
- ✅ Protected API routes
- ✅ No sensitive data in frontend

## 🚧 Roadmap

- [ ] Email campaign integration
- [ ] WhatsApp/SMS notifications
- [ ] Custom fields for leads
- [ ] Team collaboration features
- [ ] Mobile app (React Native)
- [ ] Advanced reporting & forecasting
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Bilal**
- GitHub: [@Bilal-03](https://github.com/Bilal-03)

## 🙏 Acknowledgments

- Built with [React](https://reactjs.org/)
- Database powered by [Neon & Clerk](https://neon.com/)
- Icons by [Lucide](https://lucide.dev/)
- Charts by [Recharts](https://recharts.org/)

## 💡 Support

If you found this helpful, please consider giving it a ⭐!

---

**Built with ❤️ for the sales community**

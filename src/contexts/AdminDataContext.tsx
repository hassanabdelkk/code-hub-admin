import { useEffect, useState, useCallback, useRef, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { checkRiskFlag, type EmployeeStatus, type KycStatus, type OnboardingStatus } from "@/lib/status";
export type { EmployeeStatus, KycStatus, OnboardingStatus };
import { useToast } from "@/hooks/use-toast";
import { fetchAll } from "@/lib/fetch-all";

export interface Application {
  id: string; full_name: string; first_name: string | null; last_name: string | null;
  email: string; phone: string | null; message?: string | null; status: string; created_at: string; tenant_id: string | null;
  address: string | null; postal_code: string | null; city: string | null;
  birth_date: string | null; birth_place: string | null; nationality: string | null;
  user_id?: string | null; source_slug?: string | null; source_landing_id?: string | null; target_landing_id?: string | null;
  flow_type?: string | null; booking_status?: string | null; scheduled_at?: string | null;
  interview_started_at?: string | null; interview_completed_at?: string | null; interview_recommendation?: string | null;
  interview_score?: number | null; interview_summary?: string | null; interview_messages?: unknown; interview_mode?: string | null;
}
export interface ProfileRow {
  id: string; user_id: string; full_name: string; status: EmployeeStatus; address: string | null; birth_date: string | null;
  living_since: string | null; created_at: string; contract_signed_at: string | null; onboarding_status: OnboardingStatus;
  admin_notes: string | null;
  application_id?: string | null; email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null; street?: string | null;
  zip_code?: string | null; city?: string | null; birth_place?: string | null; nationality?: string | null; previous_address?: string | null;
  id_front_url?: string | null; id_back_url?: string | null; contract_pdf_url?: string | null; signature_url?: string | null;
  social_security_number?: string | null; tax_number?: string | null; iban?: string | null; health_insurance?: string | null;
  family_status?: string | null; employment_type?: string | null; employment_start_date?: string | null; tenant_id?: string | null; team_leader_id?: string | null;
}
export interface KycRow {
  id: string; user_id: string; status: KycStatus; id_front_url: string | null; id_back_url: string | null; selfie_url: string | null;
  rejection_reason: string | null; risk_flag: boolean; reviewed_at: string | null;
}
export interface TaskTemplate {
  id: string; title: string; description: string; instructions: string; compensation: number; is_active: boolean; created_at: string;
}
export interface TaskQuestion { id: string; question: string; sort_order: number; }
export interface AssignmentRow {
  id: string; task_template_id: string; user_id: string; status: string; admin_comment: string | null; created_at: string; sms_channel_id: string | null;
}
export interface SubmissionRow {
  id: string; assignment_id: string; notes: string | null; file_urls: string[]; submitted_at: string;
}
export interface SubmissionAnswerRow { id: string; question_id: string; answer: string; }
export interface TimeSlotRow { id: string; slot_date: string; start_time: string; end_time: string; max_participants: number; created_at: string; }
export interface BookingRow { id: string; user_id: string; time_slot_id: string | null; assignment_id: string | null; status: string; created_at: string; booking_date: string | null; booking_time: string | null; application_id?: string | null; app_id?: string | null; scheduled_at?: string | null; admin_override?: boolean | null; }
export interface TransactionRow { id: string; user_id: string; assignment_id: string; amount: number; status: string; created_at: string; }
export interface ChatConversationRow { id: string; user_id: string; status: string; escalated_at: string | null; created_at: string; updated_at: string; }

interface AdminDataContextType {
  applications: Application[];
  profiles: ProfileRow[];
  kycList: KycRow[];
  templates: TaskTemplate[];
  assignments: AssignmentRow[];
  timeSlots: TimeSlotRow[];
  allBookings: BookingRow[];
  allTransactions: TransactionRow[];
  chatConversations: ChatConversationRow[];
  adminUserIds: Set<string>;
  emailConfirmedUserIds: Set<string>;
  loading: boolean;
  loadingApplications: boolean;
  loadingProfiles: boolean;
  loadData: () => Promise<void>;
  setProfiles: React.Dispatch<React.SetStateAction<ProfileRow[]>>;
  setKycList: React.Dispatch<React.SetStateAction<KycRow[]>>;
  setAllTransactions: React.Dispatch<React.SetStateAction<TransactionRow[]>>;
  getProfileForUser: (userId: string) => ProfileRow | undefined;
}

const AdminDataContext = createContext<AdminDataContextType | null>(null);

const APPLICATION_OVERVIEW_COLUMNS = "id, full_name, first_name, last_name, email, phone, status, created_at, tenant_id, address, postal_code, city, birth_date, birth_place, nationality, user_id, source_slug, source_landing_id, target_landing_id, flow_type, booking_status, scheduled_at, interview_started_at, interview_completed_at, interview_recommendation";
const PROFILE_OVERVIEW_COLUMNS = "id, user_id, full_name, application_id, phone, status, address, street, zip_code, city, birth_date, birth_place, nationality, living_since, previous_address, created_at, contract_signed_at, signature_url, onboarding_status, admin_notes, social_security_number, tax_number, iban, health_insurance, family_status, employment_type, employment_start_date, tenant_id, team_leader_id";
const KYC_OVERVIEW_COLUMNS = "id, user_id, status, id_front_url, id_back_url, selfie_url, rejection_reason, risk_flag, reviewed_at, created_at";
const TEMPLATE_OVERVIEW_COLUMNS = "id, title, description, instructions, compensation, is_active, is_published, image_url, created_at";
const ASSIGNMENT_OVERVIEW_COLUMNS = "id, task_template_id, user_id, status, admin_comment, created_at, sms_channel_id, release_at, individual_instructions, individual_phone, individual_hint, post_ident_pdf_url, post_ident_pdf_name";
const BOOKING_OVERVIEW_COLUMNS = "id, user_id, time_slot_id, assignment_id, status, created_at, booking_date, booking_time, application_id, app_id, scheduled_at, admin_override";

export function useAdminData() {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error("useAdminData must be used within AdminDataProvider");
  return ctx;
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<Application[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [kycList, setKycList] = useState<KycRow[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [allBookings, setAllBookings] = useState<BookingRow[]>([]);
  const [allTransactions, setAllTransactions] = useState<TransactionRow[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversationRow[]>([]);
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [emailConfirmedUserIds, setEmailConfirmedUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(true);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const isFirst = !hasLoadedOnceRef.current;
    if (isFirst) {
      setLoading(true);
      setLoadingApplications(true);
      setLoadingProfiles(true);
    }

    const track = async <T,>(
      label: string,
      fetcher: () => Promise<T>,
      onSuccess: (value: T) => void,
      onSettled?: () => void,
    ): Promise<{ ok: boolean; label: string; error?: string }> => {
      try {
        const value = await fetcher();
        onSuccess(value);
        return { ok: true, label };
      } catch (err: any) {
        console.error(`[AdminData] ${label} konnte nicht geladen werden`, err);
        const msg = err?.message || err?.error_description || err?.details || String(err);
        return { ok: false, label, error: msg };
      } finally {
        onSettled?.();
      }
    };

    const run = (async () => {
      // Kritische Listen zuerst und mit expliziten Spalten laden. Schwere
      // Nebentabellen laufen danach im Hintergrund, damit Navigation nicht wartet.
      const applicationsTask = track("Bewerbungen",
          () => fetchAll<Application>(() => supabase.from("applications").select(APPLICATION_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setApplications,
          () => setLoadingApplications(false));
      const profilesTask = track("Mitarbeiter",
          () => fetchAll<ProfileRow>(() => supabase.from("profiles").select(PROFILE_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setProfiles,
          () => setLoadingProfiles(false));

      Promise.allSettled([applicationsTask, profilesTask]).then(() => setLoading(false));

      const criticalTasks: Promise<{ ok: boolean; label: string; error?: string }>[] = [
        applicationsTask,
        profilesTask,
        track("Buchungen",
          () => fetchAll<BookingRow>(() => supabase.from("bookings").select(BOOKING_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setAllBookings),
        track("Admin-Rollen",
          () => fetchAll<{ user_id: string; role: string }>(() => supabase.from("user_roles").select("user_id, role").eq("role", "admin")),
          (rows) => setAdminUserIds(new Set(rows.map((r) => r.user_id)))),
      ];

      Promise.allSettled(criticalTasks).then(() => {
        setLoading(false);
        setLoadingApplications(false);
        setLoadingProfiles(false);
      });

      const criticalResults = await Promise.all(criticalTasks);

      const backgroundTasks: Promise<{ ok: boolean; label: string; error?: string }>[] = [
        track<{ user_id: string; email_confirmed: boolean }[]>("E-Mail-Bestätigungen",
          () => (supabase as any).rpc("admin_get_email_confirmations").then((r: any) => (r.data ?? []) as { user_id: string; email_confirmed: boolean }[]),
          (confs) => setEmailConfirmedUserIds(new Set(confs.filter((c) => c.email_confirmed).map((c) => c.user_id)))),
        track("KYC",
          () => fetchAll<KycRow>(() => supabase.from("kyc_verifications").select(KYC_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setKycList),
        track("Aufgaben-Vorlagen",
          () => fetchAll<TaskTemplate>(() => supabase.from("task_templates").select(TEMPLATE_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setTemplates),
        track("Aufgaben",
          () => fetchAll<AssignmentRow>(() => supabase.from("task_assignments").select(ASSIGNMENT_OVERVIEW_COLUMNS).order("created_at", { ascending: false })),
          setAssignments),
        track("Terminslots",
          () => fetchAll<TimeSlotRow>(() => supabase.from("time_slots").select("id, slot_date, start_time, end_time, max_participants, created_at").order("slot_date", { ascending: false })),
          setTimeSlots),
        track("Transaktionen",
          () => fetchAll<TransactionRow>(() => supabase.from("user_transactions").select("id, user_id, assignment_id, amount, status, created_at").order("created_at", { ascending: false })),
          setAllTransactions),
        track("Chats",
          () => fetchAll<ChatConversationRow>(() => supabase.from("chat_conversations").select("id, user_id, status, escalated_at, created_at, updated_at").order("created_at", { ascending: false })),
          setChatConversations),
      ];

      const backgroundResults = await Promise.all(backgroundTasks);
      const results = [...criticalResults, ...backgroundResults];
      const failures = results.filter((r) => !r.ok).map((r) => r.label);
      hasLoadedOnceRef.current = true;
      setLoading(false);
      setLoadingApplications(false);
      setLoadingProfiles(false);

      if (failures.length > 0) {
        const details = results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error ?? "unbekannt"}`).join(" | ");
        toast({
          title: "Admin-Daten nur teilweise geladen",
          description: `Fehlende Bereiche: ${failures.join(", ")}. Details: ${details}`,
          variant: "destructive",
        });
      }
    })();
    inFlightRef.current = run;
    try { await run; } finally { inFlightRef.current = null; }
  }, [toast]);


  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const getProfileForUser = useCallback((userId: string) => profiles.find((p) => p.user_id === userId), [profiles]);

  return (
    <AdminDataContext.Provider value={{
      applications, profiles, kycList, templates, assignments, timeSlots, allBookings, allTransactions, chatConversations,
      adminUserIds, emailConfirmedUserIds, loading, loadingApplications, loadingProfiles, loadData, setProfiles, setKycList, setAllTransactions, getProfileForUser,
    }}>
      {children}
    </AdminDataContext.Provider>
  );
}

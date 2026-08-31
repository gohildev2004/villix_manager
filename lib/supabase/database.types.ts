export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          email: string
          last_seen_at: string
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          email: string
          last_seen_at?: string
          role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          email?: string
          last_seen_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      contribution_entries: {
        Row: {
          contributor_id: string | null
          created_at: string
          gross_cents: number
          id: string
          payout_bps: number | null
          payout_cents: number | null
          receipt_id: string
          routing_snapshot: Json | null
          source_handle: string
          source_name: string
          type: string
        }
        Insert: {
          contributor_id?: string | null
          created_at?: string
          gross_cents: number
          id?: string
          payout_bps?: number | null
          payout_cents?: number | null
          receipt_id: string
          routing_snapshot?: Json | null
          source_handle: string
          source_name: string
          type: string
        }
        Update: {
          contributor_id?: string | null
          created_at?: string
          gross_cents?: number
          id?: string
          payout_bps?: number | null
          payout_cents?: number | null
          receipt_id?: string
          routing_snapshot?: Json | null
          source_handle?: string
          source_name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_entries_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_entries_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_entries_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "contribution_types"
            referencedColumns: ["type"]
          },
        ]
      }
      contribution_types: {
        Row: {
          active: boolean
          payout_bps: number
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          payout_bps: number
          type: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          payout_bps?: number
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      inbound_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          provider: string
          provider_reference: string
          received_at: string
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          id?: string
          provider: string
          provider_reference: string
          received_at: string
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          provider?: string
          provider_reference?: string
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      payee_profiles: {
        Row: {
          bank_last4: string | null
          contract_status: string
          country: string
          currency: string
          entity_type: string
          ifsc: string | null
          legal_name: string
          onboarding_status: string
          pan_last4: string | null
          payout_provider: string | null
          person_id: string
          provider_recipient_id: string | null
          updated_at: string
        }
        Insert: {
          bank_last4?: string | null
          contract_status?: string
          country?: string
          currency?: string
          entity_type?: string
          ifsc?: string | null
          legal_name?: string
          onboarding_status?: string
          pan_last4?: string | null
          payout_provider?: string | null
          person_id: string
          provider_recipient_id?: string | null
          updated_at?: string
        }
        Update: {
          bank_last4?: string | null
          contract_status?: string
          country?: string
          currency?: string
          entity_type?: string
          ifsc?: string | null
          legal_name?: string
          onboarding_status?: string
          pan_last4?: string | null
          payout_provider?: string | null
          person_id?: string
          provider_recipient_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payee_profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_cents: number
          attempt_number: number
          attempted_by: string | null
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          payout_recipient_id: string
          provider: string | null
          provider_reference: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          attempt_number: number
          attempted_by?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          payout_recipient_id: string
          provider?: string | null
          provider_reference?: string | null
          status: string
        }
        Update: {
          amount_cents?: number
          attempt_number?: number
          attempted_by?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          payout_recipient_id?: string
          provider?: string | null
          provider_reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_payout_recipient_id_fkey"
            columns: ["payout_recipient_id"]
            isOneToOne: false
            referencedRelation: "payout_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          calculation_hash: string | null
          created_at: string
          id: string
          payout_date: string | null
          period_end: string
          period_start: string
          rule_version: number
          settlement_currency: string
          source_currency: string
          status: string
          total_gross_cents: number
          total_payable_cents: number
          total_retained_cents: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          calculation_hash?: string | null
          created_at?: string
          id?: string
          payout_date?: string | null
          period_end: string
          period_start: string
          rule_version?: number
          settlement_currency?: string
          source_currency?: string
          status?: string
          total_gross_cents?: number
          total_payable_cents?: number
          total_retained_cents?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          calculation_hash?: string | null
          created_at?: string
          id?: string
          payout_date?: string | null
          period_end?: string
          period_start?: string
          rule_version?: number
          settlement_currency?: string
          source_currency?: string
          status?: string
          total_gross_cents?: number
          total_payable_cents?: number
          total_retained_cents?: number
        }
        Relationships: []
      }
      payout_recipients: {
        Row: {
          batch_id: string
          contributor_breakdown: Json
          contributor_count: number
          created_at: string
          gross_cents: number
          id: string
          paid_at: string | null
          payable_cents: number
          person_id: string
          provider_reference: string | null
          retained_cents: number
          routing_type: string
          status: string
        }
        Insert: {
          batch_id: string
          contributor_breakdown?: Json
          contributor_count?: number
          created_at?: string
          gross_cents: number
          id?: string
          paid_at?: string | null
          payable_cents: number
          person_id: string
          provider_reference?: string | null
          retained_cents: number
          routing_type: string
          status?: string
        }
        Update: {
          batch_id?: string
          contributor_breakdown?: Json
          contributor_count?: number
          created_at?: string
          gross_cents?: number
          id?: string
          paid_at?: string | null
          payable_cents?: number
          person_id?: string
          provider_reference?: string | null
          retained_cents?: number
          routing_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_recipients_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          country: string
          created_at: string
          currency: string
          display_name: string
          email: string
          handle: string
          id: string
          payout_method: string
          role: string
          status: string
          team_lead_id: string | null
          updated_at: string
        }
        Insert: {
          country?: string
          created_at?: string
          currency?: string
          display_name: string
          email: string
          handle: string
          id?: string
          payout_method?: string
          role: string
          status?: string
          team_lead_id?: string | null
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          currency?: string
          display_name?: string
          email?: string
          handle?: string
          id?: string
          payout_method?: string
          role?: string
          status?: string
          team_lead_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_team_lead_id_fkey"
            columns: ["team_lead_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          extracted_total_cents: number
          filename: string
          id: string
          imported_by: string | null
          issues: Json
          receipt_date: string
          sha256: string
          source_total_cents: number
          status: string
          storage_path: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          extracted_total_cents: number
          filename: string
          id?: string
          imported_by?: string | null
          issues?: Json
          receipt_date: string
          sha256: string
          source_total_cents: number
          status?: string
          storage_path: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          extracted_total_cents?: number
          filename?: string
          id?: string
          imported_by?: string | null
          issues?: Json
          receipt_date?: string
          sha256?: string
          source_total_cents?: number
          status?: string
          storage_path?: string
        }
        Relationships: []
      }
      team_assignments: {
        Row: {
          changed_by: string | null
          contributor_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          team_lead_id: string | null
        }
        Insert: {
          changed_by?: string | null
          contributor_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          team_lead_id?: string | null
        }
        Update: {
          changed_by?: string | null
          contributor_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          team_lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_assignments_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_assignments_team_lead_id_fkey"
            columns: ["team_lead_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


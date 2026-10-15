export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      comments: {
        Row: {
          body: string;
          id: string;
          study_id: string;
          variant_id: string;
        };
        Insert: {
          body: string;
          id?: string;
          study_id: string;
          variant_id: string;
        };
        Update: {
          body?: string;
          id?: string;
          study_id?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_variant_id_study_id_fkey";
            columns: ["variant_id", "study_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id", "study_id"];
          },
        ];
      };
      studies: {
        Row: {
          author_id: string;
          closes_at: string | null;
          closes_tz: string | null;
          created_at: string;
          id: string;
          participant_target: number;
          status: Database["public"]["Enums"]["study_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          author_id?: string;
          closes_at?: string | null;
          closes_tz?: string | null;
          created_at?: string;
          id?: string;
          participant_target: number;
          status?: Database["public"]["Enums"]["study_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          closes_at?: string | null;
          closes_tz?: string | null;
          created_at?: string;
          id?: string;
          participant_target?: number;
          status?: Database["public"]["Enums"]["study_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      study_links: {
        Row: {
          id: string;
          study_id: string;
          token: string;
          used: boolean;
        };
        Insert: {
          id?: string;
          study_id: string;
          token?: string;
          used?: boolean;
        };
        Update: {
          id?: string;
          study_id?: string;
          token?: string;
          used?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "study_links_study_id_fkey";
            columns: ["study_id"];
            isOneToOne: false;
            referencedRelation: "studies";
            referencedColumns: ["id"];
          },
        ];
      };
      variants: {
        Row: {
          content: string;
          id: string;
          position: number;
          study_id: string;
        };
        Insert: {
          content: string;
          id?: string;
          position: number;
          study_id: string;
        };
        Update: {
          content?: string;
          id?: string;
          position?: number;
          study_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variants_study_id_fkey";
            columns: ["study_id"];
            isOneToOne: false;
            referencedRelation: "studies";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          id: string;
          study_id: string;
          variant_id: string;
        };
        Insert: {
          id?: string;
          study_id: string;
          variant_id: string;
        };
        Update: {
          id?: string;
          study_id?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "votes_variant_id_study_id_fkey";
            columns: ["variant_id", "study_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id", "study_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cast_vote: {
        Args: { p_comments?: Json; p_token: string; p_variant_id: string };
        Returns: string;
      };
      close_study: { Args: { p_study_id: string }; Returns: undefined };
      create_study: {
        Args: {
          p_closes_local?: string;
          p_closes_tz?: string;
          p_participant_target: number;
          p_title: string;
          p_variants: string[];
        };
        Returns: string;
      };
      effective_status: {
        Args: { s: Database["public"]["Tables"]["studies"]["Row"] };
        Returns: Database["public"]["Enums"]["study_status"];
      };
      get_ballot: { Args: { p_token: string }; Returns: Json };
      get_study_results: { Args: { p_study_id: string }; Returns: Json };
      start_study: { Args: { p_study_id: string }; Returns: undefined };
      study_status_effective: {
        Args: {
          p_closes_at: string;
          p_status: Database["public"]["Enums"]["study_status"];
        };
        Returns: Database["public"]["Enums"]["study_status"];
      };
    };
    Enums: {
      study_status: "draft" | "active" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      study_status: ["draft", "active", "closed"],
    },
  },
} as const;

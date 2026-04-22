import { NextResponse } from "next/server";

/**
 * GET /api/docs
 * Public API documentation in OpenAPI 3.0 format
 */
export async function GET() {
  const openApiSpec = {
    openapi: "3.0.0",
    info: {
      title: "Newsletter Elite API",
      description: "White-label email marketing platform API for clients",
      version: "1.0.0",
      contact: {
        name: "Newsletter Elite Support",
        url: "https://newsletter-elite.com",
      },
      license: {
        name: "Commercial",
      },
    },
    servers: [
      {
        url: process.env.API_URL || "https://newsletter-elite.vercel.app",
        description: "Production API",
      },
      {
        url: "http://localhost:3000",
        description: "Development API",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained from /api/auth/token endpoint",
        },
      },
      schemas: {
        Subscriber: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            first_name: { type: "string", nullable: true },
            last_name: { type: "string", nullable: true },
            phone_number: { type: "string", nullable: true },
            date_of_birth: { type: "string", format: "date", nullable: true },
            country: { type: "string", nullable: true },
            region: { type: "string", nullable: true },
            city: { type: "string", nullable: true },
            latitude: { type: "number", nullable: true },
            longitude: { type: "number", nullable: true },
            confirmed: { type: "boolean" },
            unsubscribed: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        Campaign: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            subject: { type: "string" },
            audience: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "scheduled", "sent", "failed"],
            },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        SubscriberList: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            opt_in_type: { type: "string", enum: ["single", "double"] },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            details: { type: "string", nullable: true },
          },
          required: ["error"],
        },
      },
    },
    paths: {
      "/api/auth/token": {
        post: {
          summary: "Authenticate and get JWT token",
          description:
            "Exchange email and password for a JWT token valid for 30 days",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                    workspaceId: {
                      type: "string",
                      format: "uuid",
                      nullable: true,
                      description: "Optional workspace ID to target specific workspace",
                    },
                  },
                  required: ["email", "password"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Authentication successful",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      token: { type: "string", description: "JWT token" },
                      workspaceId: { type: "string", format: "uuid" },
                      email: { type: "string" },
                      role: {
                        type: "string",
                        enum: ["owner", "editor", "viewer"],
                      },
                      expiresIn: {
                        type: "number",
                        description: "Token expiration in seconds",
                      },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Invalid credentials",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/auth/verify": {
        get: {
          summary: "Verify JWT token",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "Token valid",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      valid: { type: "boolean" },
                      payload: {
                        type: "object",
                        properties: {
                          workspaceId: { type: "string", format: "uuid" },
                          userId: { type: "string", format: "uuid" },
                          email: { type: "string" },
                          role: {
                            type: "string",
                            enum: ["owner", "editor", "viewer"],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/clients/{workspaceId}/subscribers": {
        get: {
          summary: "List workspace subscribers",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100, maximum: 1000 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["confirmed", "pending", "unsubscribed"],
              },
            },
          ],
          responses: {
            "200": {
              description: "Subscriber list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      subscribers: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Subscriber" },
                      },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        post: {
          summary: "Add subscriber to workspace",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string", format: "email" },
                    first_name: { type: "string" },
                    last_name: { type: "string" },
                    phone_number: { type: "string" },
                    date_of_birth: { type: "string", format: "date" },
                    country: { type: "string" },
                    region: { type: "string" },
                    city: { type: "string" },
                    latitude: { type: "number" },
                    longitude: { type: "number" },
                    consent_email_marketing: { type: "boolean" },
                    consent_analytics_tracking: { type: "boolean" },
                  },
                  required: ["email"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Subscriber created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Subscriber" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/clients/{workspaceId}/campaigns": {
        get: {
          summary: "List workspace campaigns",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Campaign list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      campaigns: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Campaign" },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create campaign",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    subject: { type: "string" },
                    audience: {
                      type: "string",
                      description: "audience: confirmed|all|pending|claimed_offer|list:<id>",
                    },
                    editor_html: { type: "string" },
                    editor_css: { type: "string" },
                  },
                  required: ["name", "subject"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Campaign created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Campaign" },
                },
              },
            },
          },
        },
      },
      "/api/clients/{workspaceId}/automations": {
        get: {
          summary: "List automation triggers",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Automation list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      automations: { type: "array" },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create automation trigger",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "workspaceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    trigger_type: {
                      type: "string",
                      enum: [
                        "subscriber_joined",
                        "lead_magnet_claimed",
                        "location_change",
                        "custom_webhook",
                      ],
                    },
                    action_type: {
                      type: "string",
                      enum: ["send_email", "add_to_list", "send_notification"],
                    },
                  },
                  required: ["name", "trigger_type", "action_type"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Automation created",
            },
          },
        },
      },
      "/api/webhooks/automation-trigger": {
        post: {
          summary: "Trigger an automation workflow (public endpoint)",
          description:
            "Call this endpoint from external systems (service site, webhooks, etc) to trigger automation workflows",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    workspace_id: {
                      type: "string",
                      format: "uuid",
                      description: "The workspace to trigger automations for",
                    },
                    trigger_type: {
                      type: "string",
                      enum: [
                        "subscriber_joined",
                        "lead_magnet_claimed",
                        "location_change",
                      ],
                    },
                    subscriber_id: {
                      type: "string",
                      format: "uuid",
                      nullable: true,
                    },
                    event_data: {
                      type: "object",
                      description: "Trigger-specific event data",
                    },
                  },
                  required: ["workspace_id", "trigger_type", "event_data"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Automations triggered",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      automations_triggered: { type: "integer" },
                      logs: { type: "array" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [],
  };

  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

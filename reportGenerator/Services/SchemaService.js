import pool from '../Config/Db.js';

export class SchemaService {
    async getAllTableSchemas() {
        try {
            // Get tables with their columns and constraints
            const query = `
                SELECT 
                    t.table_name,
                    json_agg(
                        json_build_object(
                            'column_name', c.column_name,
                            'data_type', c.data_type,
                            'is_nullable', c.is_nullable,
                            'column_default', c.column_default
                        )
                    ) as columns,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'constraint_name', tc.constraint_name,
                                'constraint_type', tc.constraint_type
                            )
                        )
                        FROM information_schema.table_constraints tc
                        WHERE tc.table_name = t.table_name
                    ) as constraints
                FROM 
                    information_schema.tables t
                    JOIN information_schema.columns c ON t.table_name = c.table_name
                WHERE 
                    t.table_schema = 'public'
                GROUP BY 
                    t.table_name;
            `;

            const result = await pool.query(query);
            
            // Transform the result into a more readable format
            const schemaMap = {};
            result.rows.forEach(table => {
                schemaMap[table.table_name] = {
                    columns: table.columns,
                    constraints: table.constraints || []
                };
            });

            return schemaMap;
        } catch (error) {
            console.error('Error fetching schema:', error);
            throw error;
        }
    }

    // Helper method to get relationships between tables
    async getTableRelationships() {
        try {
            const query = `
                SELECT
                    tc.table_name as table_name,
                    kcu.column_name as column_name,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name
                FROM 
                    information_schema.table_constraints AS tc 
                    JOIN information_schema.key_column_usage AS kcu
                        ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage AS ccu
                        ON ccu.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY';
            `;

            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error fetching relationships:', error);
            throw error;
        }
    }
} 

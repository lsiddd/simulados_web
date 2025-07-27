// src/cache.rs
use redis::{AsyncCommands, Client};
use std::sync::Arc;
use anyhow::{Result, Context};
use log::{debug, error, info};

pub struct RedisCache {
    client: Client,
}

impl RedisCache {
    pub async fn new() -> Result<Arc<Self>> {
        let redis_url = "redis://redis/";
        info!("Attempting to create Redis client for URL: {}", redis_url);
        let client = Client::open(redis_url)
            .context("Failed to create Redis client from URL")?;
        
        // Test the connection immediately to fail fast
        info!("Pinging Redis to test connection...");
        let mut conn = client.get_async_connection().await
            .context("Failed to establish initial test connection to Redis. Is the 'redis' service running and accessible?")?;
        
        let pong: String = redis::cmd("PING").query_async(&mut conn).await
            .context("Failed to execute PING command on initial Redis connection")?;

        if pong == "PONG" {
            info!("Successfully PINGed Redis and received PONG.");
        } else {
            return Err(anyhow::anyhow!("Received unexpected response from Redis PING: {}", pong));
        }

        Ok(Arc::new(RedisCache { client }))
    }

    async fn get_connection(&self) -> Result<redis::aio::Connection> {
        self.client.get_async_connection().await
            .context("Failed to get async connection from Redis client pool")
    }

    pub async fn get_simulados_list(&self) -> Result<Option<Vec<crate::simulado_store::SimuladoList>>> {
        let mut conn = self.get_connection().await?;

        let result: redis::RedisResult<Option<String>> = conn.get("simulados_list").await;

        match result {
            Ok(Some(json_data)) => {
                debug!("Redis HIT for 'simulados_list'. Deserializing.");
                serde_json::from_str(&json_data)
                    .map(Some)
                    .context("Failed to deserialize simulados list from Redis JSON")
            },
            Ok(None) => {
                debug!("Redis MISS for 'simulados_list'.");
                Ok(None)
            },
            Err(e) => {
                error!("Redis error when getting 'simulados_list': {}", e);
                Err(e.into())
            }
        }
    }
    
    pub async fn set_simulados_list(&self, data: &[crate::simulado_store::SimuladoList]) -> Result<()> {
        let json = serde_json::to_string(data).context("Failed to serialize simulados list for Redis")?;
        let mut conn = self.get_connection().await?;
        conn.set_ex::<_, _, ()>("simulados_list", json, 600).await.context("Failed to execute SETEX on Redis")?;
        debug!("Successfully cached 'simulados_list' in Redis.");
        Ok(())
    }

    pub async fn get_simulado(&self, key: &str) -> Result<Option<crate::simulado_store::Simulado>> {
        let mut conn = self.get_connection().await?;
        let result: redis::RedisResult<Option<String>> = conn.get(key).await;
        match result {
            Ok(Some(json_data)) => {
                serde_json::from_str(&json_data).map(Some).context("Failed to deserialize simulado from Redis")
            },
            Ok(None) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn set_simulado(&self, key: &str, data: &crate::simulado_store::Simulado) -> Result<()> {
        let json = serde_json::to_string(data).context("Failed to serialize simulado for Redis")?;
        let mut conn = self.get_connection().await?;
        conn.set_ex::<_, _, ()>(key, json, 3600).await.context("Failed to execute SETEX for simulado on Redis")?;
        Ok(())
    }

    pub async fn invalidate_simulados_list(&self) {
        info!("Invalidating 'simulados_list' key in Redis.");
        if let Ok(mut conn) = self.get_connection().await {
            let _ : redis::RedisResult<()> = conn.del("simulados_list").await;
        } else {
            error!("Could not connect to Redis to invalidate simulados_list cache.");
        }
    }
}
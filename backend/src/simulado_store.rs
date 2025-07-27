use log::info;
// src/simulado_store.rs
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::RwLock};
use anyhow::Result;
use std::fs;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Questao {
    pub id: i64, 
    pub enunciado: String,
    pub alternativas: Vec<String>,
    #[serde(rename = "alternativa_correta")]
    pub resposta_correta: String,
    pub explicacao: String,
    
    #[serde(skip)]
    pub original_index: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Simulado {
    pub titulo: String,
    pub descricao: String,
    pub questoes: Vec<Questao>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SimuladoList {
    pub id: String,
    pub titulo: String,
    pub descricao: String,
    pub questoes_count: usize,
}

pub struct SimuladoStore {
    pub path: String,
    cache: RwLock<HashMap<String, Simulado>>,
    list_cache: RwLock<Vec<SimuladoList>>,
}

impl SimuladoStore {
    pub fn new(path: &str) -> Self {
        info!("Initializing SimuladoStore with path: '{}'", path);
        let store = SimuladoStore {
            path: path.to_string(),
            cache: RwLock::new(HashMap::new()),
            list_cache: RwLock::new(Vec::new()),
        };
        // FIX: Eagerly load the simulados list into the cache on creation.
        // This guarantees the data is ready before any requests arrive.
        info!("Performing initial load of simulados from disk...");
        store.get_simulados_list();
        store
    }


    pub fn load_simulado(&self, id: &str) -> Result<Simulado> {
        let path = format!("{}/{}.json", self.path, id);
        let data = fs::read_to_string(path)?;
        let mut simulado: Simulado = serde_json::from_str(&data)?;
        
        // Add original indexes
        for (idx, questao) in simulado.questoes.iter_mut().enumerate() {
            questao.original_index = idx;
        }
        
        Ok(simulado)
    }

    pub fn get_simulado(&self, id: &str) -> Option<Simulado> {
        // Check cache first
        {
            let cache = self.cache.read().unwrap();
            if let Some(simulado) = cache.get(id) {
                return Some(simulado.clone());
            }
        }
        
        // Load from disk
        match self.load_simulado(id) {
            Ok(simulado) => {
                // Add to cache
                let mut cache = self.cache.write().unwrap();
                cache.insert(id.to_string(), simulado.clone());
                Some(simulado)
            }
            Err(_) => None,
        }
    }

    pub fn get_simulados_list(&self) -> Vec<SimuladoList> {
        // Check cache first
        {
            let cache = self.list_cache.read().unwrap();
            if !cache.is_empty() {
                return cache.clone();
            }
        }
        
        // Load from disk
        let mut list = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.path) {
            for entry in entries.flatten() {
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.ends_with(".json") {
                        let id = file_name.trim_end_matches(".json");
                        if let Some(simulado) = self.get_simulado(id) {
                            list.push(SimuladoList {
                                id: id.to_string(),
                                titulo: simulado.titulo,
                                descricao: simulado.descricao,
                                questoes_count: simulado.questoes.len(),
                            });
                        }
                    }
                }
            }
        }
        
        // Update cache
        let mut cache = self.list_cache.write().unwrap();
        *cache = list.clone();
        list
    }

    pub fn invalidate_cache(&self) {
        let mut cache = self.cache.write().unwrap();
        cache.clear();
        
        let mut list_cache = self.list_cache.write().unwrap();
        list_cache.clear();
    }
}

impl Questao {
    pub fn shuffle_alternatives(&mut self) {
        use rand::seq::SliceRandom;
        let mut rng = rand::rng();
        self.alternativas.shuffle(&mut rng);
    }
}
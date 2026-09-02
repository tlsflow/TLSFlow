<div align="center">

<img src="../../web/public/brand/tlsflow-lockup.svg" alt="TLSFlow" width="480">

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)
![Vue](https://img.shields.io/badge/Vue-3.5+-4FC08D.svg?logo=vue.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-latest-E0234E.svg?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)

**Plateforme d'automatisation du cycle de vie des certificats SSL/TLS de niveau entreprise**

[English](README.en.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md)

</div>

---

## ⚠️ Avis important

Veuillez lire attentivement ce qui suit avant d'utiliser ce projet :

- **Risque lié aux conditions d'utilisation :** L'utilisation de ce projet dans des environnements de production commerciaux nécessite une licence commerciale distincte ou un CLUF. La licence par défaut PolyForm Noncommercial 1.0.0 autorise uniquement l'utilisation non commerciale. Veuillez consulter le fichier [LICENSE](../../LICENSE) et contacter le titulaire des droits avant tout déploiement commercial.

- **Utilisation conforme :** N'utilisez ce projet qu'en conformité avec les lois et réglementations de votre pays ou région. Toute utilisation illégale est strictement interdite.

- **Clause de non-responsabilité :** Ce projet est fourni à des fins d'apprentissage technique, de recherche et d'évaluation. Les auteurs n'assument aucune responsabilité pour les incidents de production, la perte de données ou tout autre dommage direct ou indirect résultant de l'utilisation de ce projet dans des environnements non pris en charge.

---

## Présentation du produit

### Ne laissez pas l'expiration des certificats ruiner votre activité

Des centaines de serveurs, des dizaines de types d'applications, différents environnements réseau : que faire lorsque les certificats approchent de leur expiration ? Les mises à jour manuelles prennent du temps, sont sujettes aux erreurs et peuvent entraîner des interruptions de service. TLSFlow vous aide à gérer les certificats, à les déployer automatiquement et à effectuer des retours en arrière automatiques en cas de problème, afin que le renouvellement des certificats ne soit plus une bombe à retardement.

Grâce à son système de plugins et à l'orchestration de flux de travail, il prend en charge de manière extensible divers serveurs Web, serveurs d'applications, équilibreurs de charge, dispositifs de passerelle, plateformes cloud et environnements de conteneurs.

### Valeur du produit

| Valeur | Description |
| --- | --- |
| **Connaître le nombre de certificats** | Plus besoin de fouiller dans Excel et les e-mails : où se trouve chaque certificat, à quelle application il est lié, quand il expire, tout est consultable en un instant. |
| **Mise à jour groupée en un clic** | Windows, Linux, plateformes cloud, équipements réseau : tous peuvent être déployés automatiquement, sans avoir à se connecter manuellement en SSH sur chaque machine au milieu de la nuit. |
| **Retour en arrière automatique en cas d'échec** | Sauvegarde automatique avant mise à jour, vérification automatique après mise à jour, retour immédiat à la configuration d'origine en cas de problème détecté, réduisant le risque d'interruption d'activité. |
| **Notifications avant expiration** | Rappels automatiques avant expiration, alertes immédiates en cas d'échec de déploiement, notifications via WeChat, e-mail, DingTalk et autres canaux. |

## Points de douleur et défis

### L'ère des certificats de 47 jours approche

Le CA/B Forum a adopté le SC081v3 le 11 avril 2025, réduisant progressivement la durée de validité maximale des certificats TLS/SSL à confiance publique selon les étapes suivantes :

| Phase | Durée maximale | Date d'entrée en vigueur | Rotations annuelles estimées |
| --- | ---: | --- | ---: |
| Actuelle | 1 an | Actuelle | Environ 1 fois |
| Phase 1 | 200 jours | 2026-03-15 | Environ 2 fois |
| Phase 2 | 100 jours | 2027-03-15 | Environ 4 fois |
| Phase 3 | 47 jours | 2029-03-15 | Environ 8 fois |

Doubler la fréquence de mise à jour signifie que la demande, le déploiement, la vérification et le retour en arrière doivent devenir des processus automatisés reproductibles.

### Personnel de support opérationnel : Combien de certificats l'entreprise doit-elle gérer ?

- Les noms de domaine publics sont dispersés chez plusieurs fournisseurs cloud, les passerelles réseau internes sont réparties dans les succursales ;
- Les informations sur les certificats sont dispersées dans Excel, les e-mails et les dossiers partagés, rendant difficile le suivi de la quantité, des dates d'expiration et des emplacements de déploiement ;
- Chaque inventaire nécessite une compilation ad hoc, sujette aux omissions, duplications et responsabilités peu claires.

**Solution TLSFlow** : Fournit un centre d'actifs de certificats pour gérer de manière centralisée tous les certificats et leurs emplacements de déploiement.

### Responsables de mise en œuvre d'applications : Comment faire face à l'ère des certificats de 47 jours ?

- Les certificats actuels sont généralement renouvelés une fois par an ; pour 200 applications à 2 heures chacune, un cycle nécessite environ 400 heures ;
- Lorsque la période de validité se raccourcit à 47 jours, les renouvellements annuels augmentent à environ 8 fois, multipliant proportionnellement les coûts de main-d'œuvre répétitifs ;
- Sans processus d'automatisation unifié, la demande, le téléchargement, la configuration, le redémarrage et la vérification deviennent difficiles à maintenir de manière continue.

**Solution TLSFlow** : Les processus de déploiement automatisés réduisent le temps de mise à jour unique d'heures à minutes.

### Responsables de maintenance d'applications : L'expiration ou l'échec d'installation de certificats a-t-il causé des interruptions d'activité ?

- L'expiration de certificats peut entraîner l'inaccessibilité du site Web, l'échec des interfaces d'applications mobiles, l'interruption des API partenaires ;
- Les mises à jour manuelles impliquent de nombreuses étapes ; les erreurs de configuration et la vérification tardive introduisent facilement des problèmes en environnement de production ;
- Même avec un traitement rapide, l'activité peut déjà être interrompue pendant des heures, entraînant des plaintes et des préoccupations des clients ;
- Le manque d'enregistrements de changements unifiés et de références de récupération signifie que le dépannage, le retour en arrière et l'analyse post-mortem dépendent uniquement de l'expérience manuelle.

**Solution TLSFlow** : Fournit des alertes d'expiration, une vérification automatique post-déploiement et des mécanismes de retour en arrière en cas d'échec.

### Personnel de sécurité de l'information : Quels sont les risques de sécurité liés à l'utilisation généralisée de certificats génériques sur les réseaux internes ?

- Un seul certificat générique et sa clé privée sont copiés sur des dizaines, voire des centaines de serveurs du réseau interne ;
- Toute compromission de serveur, fuite de sauvegarde ou erreur opérationnelle peut provoquer une diffusion de la clé privée ;
- La portée du déploiement ne peut pas être suivie ; une fois qu'un certificat nécessite une révocation, l'évaluation d'impact et l'enquête à l'échelle du réseau deviennent difficiles ;
- Les limites d'utilisation de la clé privée et les entités de déploiement réelles ne sont pas claires, rendant difficile la mise en œuvre de l'audit, de la rotation et des responsabilités de conformité.

**Solution TLSFlow** : Recommande de combiner certificats privés internes, certificats génériques publics et déploiement automatisé pour réduire le risque de diffusion de clés privées.

### Gestionnaires d'équipe : À quelle distance votre équipe est-elle de l'ère des certificats de 47 jours ?

- Confirmez d'abord si l'inventaire des actifs est complet et si les certificats, serveurs, applications et responsables peuvent être correctement associés ;
- Évaluez ensuite la couverture de l'automatisation pour réduire la dépendance à l'expérience personnelle, aux scripts temporaires et aux connexions manuelles ;
- Vérifiez enfin si l'équipe possède des capacités de réponse rapide, de traçabilité d'approbation et de retour en arrière en cas d'échec ;
- Intégrez les rappels d'expiration, la vérification de déploiement et les enregistrements d'exécution dans une boucle fermée unifiée pour faire face de manière continue aux cycles de 47 jours.

**Solution TLSFlow** : Fournit une solution complète allant de l'inventaire des actifs au déploiement automatisé jusqu'à la surveillance et aux alertes.

## Présentation des fonctionnalités

### Ce que TLSFlow peut faire

| Fonctionnalité | Description |
| --- | --- |
| **Gestion unifiée des actifs de certificats** | Gérez de manière centralisée les actifs de certificats, les versions, les conversions de format et la vérification de chaîne de confiance. Prend en charge plusieurs formats dont PEM/PFX/JKS/P7B. Détecte automatiquement l'expiration des certificats et archive les versions historiques. |
| **Intégration de certificats multi-sources** | Prend en charge l'importation manuelle, CA interne (OpenSSL/ACME), certificats de fournisseurs cloud (Alibaba Cloud CDN), Microsoft AD CS et d'autres sources de certificats. Analyse automatiquement les chaînes de certificats et les mappe aux actifs gérés. |
| **Découverte d'applications dans des environnements hétérogènes** | Découvre automatiquement divers serveurs Web, serveurs d'applications, équilibreurs de charge et autres actifs d'application via Agent. Identifie les liaisons de certificats actuelles et la compatibilité. |
| **Déploiement automatisé par flux de travail** | Orchestre les flux de travail de déploiement de certificats basés sur DSL. Prend en charge l'exécution à distance SSH, les appels d'API CURL, les transferts de fichiers. Intègre des pré-vérifications, sauvegardes, vérifications et garanties de retour en arrière. |
| **Système de plugins extensible** | Inclut 20 plugins d'applications à haute fréquence couvrant serveurs Web, middleware d'applications, équilibreurs de charge, dispositifs de passerelle, plateformes cloud, etc. Prend en charge les extensions de plugins personnalisés pour s'adapter à tout environnement cible. |
| **Surveillance continue et alertes** | Surveillance en temps réel de l'expiration des certificats, dérive de liaison, échecs de vérification de chaîne, anomalies de déploiement. Notification d'alerte multi-canaux via e-mail/Webhook/DingTalk/WeCom/Feishu/Slack/Telegram. |
| **Flux d'approbation et audit** | Prend en charge les déclencheurs d'approbation par niveau de risque et type d'opération (installation/activation de plugin, exécution de flux de travail, opérations de retour en arrière). Enregistre complètement les journaux d'opérations et les instantanés d'exécution. |
| **Contrôle d'accès à granularité fine** | Basé sur le modèle d'autorisation RBAC + objet. Attribue des permissions par actif de certificat, application, dimensions Agent. Prend en charge l'isolation des locataires et la collaboration interservices. |

### Points de douleur dans des scénarios réels

| Problèmes que vous pourriez rencontrer | Comment TLSFlow les résout |
| --- | --- |
| Les informations sur les certificats sont dispersées dans les e-mails, Excel, disques partagés—introuvables temporairement en cas de besoin | Tous les certificats gérés de manière centralisée ; recherchez pour trouver immédiatement les emplacements d'utilisation et les responsables. |
| Après les mises à jour, incertain si elles ont pris effet ; découvrez les erreurs de configuration après les plaintes des utilisateurs | Accès automatique HTTPS post-mise à jour ; confirmez l'empreinte correcte avant de marquer comme terminé. |
| Lorsque des problèmes surviennent, ne sait pas qui a changé quoi, impossible de retracer | Chaque mise à jour enregistre l'opérateur, l'horodatage et les modifications pour révision ultérieure à tout moment. |
| La zone de production interdit l'accès au réseau externe, impossible d'installer Agent, seule la connexion manuelle est possible | Utilisez Gateway pour connexion active, ou déployez directement via SSH sans Agent. |

## Avantages du produit

### Pourquoi TLSFlow est mieux adapté aux entreprises

- **Compatibilité avec les systèmes hérités** : De nombreux systèmes ne peuvent pas installer d'Agents et les réseaux ont des zones d'isolation. TLSFlow offre plusieurs méthodes d'intégration, permettant d'intégrer les systèmes hérités et les réseaux isolés dans la gestion sans refonte majeure.
- **Retour automatique en cas d'échec de mise à jour de certificat** : Sauvegarde automatique avant les mises à jour ; en cas d'échec de vérification, restaure automatiquement la configuration d'origine en fonction de l'inventaire de sauvegarde et des points de contrôle. Prend en charge à la fois le déclenchement automatique de politique d'échec et le retour en arrière manuel, évitant de se précipiter pour revenir en arrière après une interruption d'activité.
- **Gestion des applications courantes et spéciales** : Les applications à haute fréquence utilisent directement les plugins intégrés ; les appareils de niche et les processus spéciaux peuvent orchestrer les étapes de mise à jour via le DSL de flux de travail pour une extensibilité illimitée.
- **Associations de certificats claires** : Chaque certificat est lié à des serveurs, sites et applications spécifiques pour une évaluation rapide de l'impact lorsque des problèmes surviennent.
- **Contrôle d'accès complet** : Différents rôles ont différentes permissions ; les opérations sensibles nécessitent une approbation basée sur des politiques ; les mots de passe et clés privées ne sont pas affichés en texte clair dans les journaux.
- **Journaux d'audit complets** : Chaque mise à jour affiche les étapes d'exécution, les certificats utilisés et les modifications de configuration pour révision en cas de problème—pas d'opérations en boîte noire.

## Cas d'utilisation

- **Environnements hétérogènes complexes** : Plusieurs serveurs Web, middleware d'applications, équilibreurs de charge, dispositifs de passerelle et plateformes cloud coexistent, rendant la maintenance manuelle insoutenable ;
- **Zones d'isolation et systèmes hérités** : Les zones de production restreignent l'installation de logiciels, les systèmes hérités ne peuvent pas être mis à niveau, mais les certificats nécessitent toujours des mises à jour ;
- **Réseaux internes entièrement isolés** : Environnements de production physiquement isolés d'Internet, incapables d'utiliser les services de certificats en ligne du cloud public ;
- **Exigences d'approbation et d'enregistrement** : Les changements de certificats sont des opérations sensibles nécessitant des flux de travail d'approbation, une traçabilité opérationnelle et des pistes d'audit complètes.

Arrêtez de faire des mises à jour de certificats une bombe à retardement. TLSFlow utilise une gestion d'actifs unifiée, un déploiement automatisé, un retour en arrière sécurisé et des alertes continues pour aider les équipes à faire face aux cycles de rotation de certificats de plus en plus courts.

## Architecture technique

Le projet adopte une architecture en couches et modulaire : la plateforme centrale gère uniformément les données, les permissions et les contrats d'exécution, tandis que la couche d'exécution peut être remplacée selon les cibles.

| Composant | Technologie et responsabilités |
| --- | --- |
| Console Web | Vue 3, TypeScript, Vite, Pinia, vue-i18n |
| Backend | NestJS, TypeScript ; modules de domaine divisés par limites métier fournissant des interfaces REST/OpenAPI |
| Persistance des données | Le déploiement standard utilise PostgreSQL 16 ; l'évaluation sur nœud unique utilise PGlite |
| Browser Runtime | Node.js, Playwright ; fournit des sessions de navigateur isolées et des flux d'informations d'identification contrôlés |
| TLS Inspector | Service Node.js indépendant pour la négociation TLS et l'analyse de l'état des certificats |
| Full Agent / CA Node | Programmes natifs Go gérant respectivement l'exécution sur l'hôte et les limites d'émission CA isolées |
| Runtime d'extension | Manifest, Host API, Runner, Workflow DSL et répertoire de compatibilité |
| Méthodes de déploiement | standard utilise Docker Compose ; small utilise un conteneur unique `docker run` |

## Démarrage rapide

### Prérequis

- Hôte Linux, macOS ou NAS
- Docker CLI ; le déploiement standard nécessite en plus Docker Compose v2
- Accès aux appareils cibles et aux services de certificats
- Les environnements de production utilisent des clés d'exécution aléatoires et inchangées à long terme

Le déploiement d'images pré-construites ne nécessite pas Node.js, Go, Buildx ou code source.

### Déploiement sur nœud unique

Convient aux environnements de petite échelle avec moins de 50 actifs d'application, utilisant la base de données intégrée PGlite, fonctionnement en conteneur unique.

Démarrage rapide (utilisant un volume nommé Docker) :

```bash
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  -p 8085:3003 \
  -e GCAC_PUBLIC_BASE_URL=http://your-host:8085 \
  -e GCAC_SECRET_KEK=your-random-kek \
  -v tlsflow-small-data:/app/data \
  tlsflow/gcac-small:latest
```

**Important** :
- Les environnements de production doivent remplacer `GCAC_SECRET_KEK` par une clé aléatoire
- Le mot de passe administrateur est défini via l'assistant d'initialisation lors du premier accès
- Adresse d'accès par défaut : `http://<adresse-hôte>:8085/`

Pour la configuration détaillée des paramètres, la liaison de répertoires hôte, le proxy inverse HTTPS et d'autres scénarios, veuillez consulter la documentation complète.

### Déploiement standard

Convient aux environnements de production et aux scénarios multi-locataires, utilisant la base de données PostgreSQL 16, prend en charge les sessions de navigateur Browser Runtime.

**1. Préparer le fichier de configuration**

```bash
cp docker/.env.example docker/.env
```

Modifiez `docker/.env`, remplissez au minimum :
- `GCAC_RELEASE_VERSION` : Tag d'image (utilisez une version fixe en production)
- `GCAC_PUBLIC_BASE_URL` : Adresse Web accessible par Agent
- `POSTGRES_PASSWORD` : Mot de passe de la base de données
- `GCAC_TOKEN_SECRET` : Clé de signature de jeton de connexion
- `GCAC_SECRET_KEK` : Clé racine de chiffrement (doit rester inchangée à long terme)

**2. Démarrer les services**

```bash
cd docker
docker compose pull
docker compose up -d
```

**3. Vérification**

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

Confirmez que le statut de `db` est `healthy`, accédez à `http://<adresse-hôte>:8085/` pour compléter l'assistant d'initialisation.

**Browser Runtime** (optionnel) : Lorsque des informations d'identification de connexion au navigateur sont nécessaires, définissez `BROWSER_RUNTIME_ENABLED=true` dans `.env` et remplissez `BROWSER_RUNTIME_SHARED_SECRET`, puis exécutez `docker compose up -d`.

Pour la configuration détaillée des ressources, les répertoires de données, la sauvegarde et la récupération, veuillez consulter la documentation complète.

## Répertoire du projet

```text
backend/          Backend NestJS, migrations de base de données, hôte de plugins, orchestration d'exécution
web/              Console de gestion Vue 3
browser-runtime/  Runtime de navigateur contrôlé
tls-inspector/    Service de négociation TLS et de détection de certificats
agents/           Windows/Linux Agent, CA Node, Gateway Agent
docker/           Dockerfile, Compose, outils de construction d'images et de packages de version Agent
data/             Répertoire de plugins d'exécution, base de données, flux de travail et données d'exécution
docs/             Manuel utilisateur, documentation de développement, guide opérationnel, matériaux produit
specs/            Exigences et spécifications de conception organisées par domaine
scripts/          Vérifications d'architecture, vérifications de compatibilité, gouvernance de plugins, outils de version publique
```

## Développement secondaire et extension

### Choisir la bonne méthode d'extension

1. **Ajout de systèmes ordinaires ou d'environnements authentifiés** : Privilégiez la réutilisation des capacités Agent, SSH, CURL et plateforme existantes. Ajoutez des configurations et des enregistrements de vérification via le répertoire de compatibilité avec des modifications minimales du code central.
2. **Ajout de produits à haute fréquence** : Développez des plugins de produits encapsulant la connexion aux appareils, la confirmation d'identité, la découverte en lecture seule, le mappage d'actifs d'application, les plans de déploiement et la vérification cible.
3. **Ajout d'appareils de niche ou d'API internes** : Écrivez des DSL de flux de travail versionnés utilisant des étapes contrôlées comme SSH, SFTP, SCP, CURL, conditions, transformations, attentes, confirmations manuelles, extractions et assertions.
4. **Besoin réel de nouvelles limites d'exécution** : Ensuite, évaluez si de nouvelles gammes de produits Agent ou capacités hôtes sont nécessaires, en complétant d'abord les contrats de protocole, permission, audit et retour en arrière.

### Limites du développement de plugins

- Les plugins déclarent l'identité, la version, les capacités, les permissions et la portée de compatibilité via `Manifest` ;
- Les plugins utilisent par défaut uniquement Host API, Secret, Artifact, audit, verrous et autorisation d'exécution fournis par l'hôte ;
- Les plugins intégrés sont situés dans `backend/src/modules/plugins/builtin-plugins/<pluginId>/` ;
- Les plugins utilisateur sont placés dans `data/plugins/` et publiés via l'interface d'importation de package de plugin unifiée ;
- Les ressources de flux de travail de plugin doivent être synchronisées avec les versions de plugin ; les tests de processus de mise à jour de certificat doivent être terminés et les enregistrements d'itération sauvegardés avant la publication ;
- Les plugins ne peuvent pas contourner l'hôte pour lire directement les données de locataire, les informations d'identification en texte clair ou exécuter arbitrairement des processus hôtes.

Documentation d'entrée : [Développement de plugins](../../docs/Documentation/developer/plugin-development.md), [Capacités de plugins hôtes](../../docs/Documentation/developer/host-plugin-capabilities.md), [Développement de flux de travail](../../docs/Documentation/developer/workflow-development.md).

### Limites du DSL de flux de travail

Les modèles de flux de travail utilisent le protocole propriétaire du projet `gcac.workflow/v1`. Les sources de modèles sont uniquement :

- Modèles intégrés : `backend/src/modules/workflow-templates/builtin-workflows` ;
- Modèles importés par l'utilisateur : `data/workflows` (créés à l'exécution selon les besoins, pas un répertoire de modèles intégré).

Les mots de passe, jetons, clés privées et artefacts de certificats doivent être référencés via `SecretRef` ou Artifact Slot, et ne peuvent pas être écrits dans DSL, variables ordinaires, journaux ou instantanés d'exécution. Les processus de déploiement doivent maintenir les phases `prepare → backup → install → refresh → verify` ; le retour en arrière utilise la version de flux de travail d'origine et les instantanés d'entrée.

### Développement local et vérification

Le dépôt n'exige pas que les services de développement démarrent automatiquement dans le cadre de la livraison README. Points d'entrée courants de construction et de test :

```bash
# Construction backend
npm --prefix backend run build

# Vérification de type frontend et construction de production
npm --prefix web run build

# Construction Browser Runtime
npm --prefix browser-runtime run build

# Test TLS Inspector
npm --prefix tls-inspector test

# Tests unitaires et contractuels frontend
npm --prefix web run test:unit
```

Les tests complets backend, les vérifications d'architecture de compatibilité, les vérifications de version de plugin et les constructions Agent ont des exigences environnementales supplémentaires—veuillez suivre la documentation du module correspondant et les spécifications du projet. Réussir les tests ne signifie pas avoir terminé l'acceptation de vrais appareils de fournisseurs, CA externes, réseaux isolés ou retours en arrière de production.

## Limites de sécurité et de production

- `GCAC_SECRET_KEK` est la clé racine de déchiffrement pour les matériaux de sécurité d'exécution ; doit être sauvegardée indépendamment ; interdite d'être écrite dans le code, les journaux, la documentation publique ou les navigateurs ;
- Ne placez pas de clés privées de signature de licence dans les dépôts, images ou variables d'environnement de conteneur ; les déploiements publics n'ont besoin que de clés publiques de confiance de licence ;
- Le Browser Runtime standard ne doit être accessible que via des réseaux internes et des proxies Web ;
- Les matériaux sensibles comme les certificats, clés privées, jetons, mots de passe PFX/JKS ne doivent pas entrer dans les variables ordinaires, journaux d'exécution ou modèles de flux de travail ;
- Les versions cibles, conditions de permission, canaux d'exécution et compatibilité réelle doivent être acceptés séparément ; le code statique, le schéma et les tests unitaires ne peuvent pas remplacer la vérification sur site ;
- La topologie Compose standard est conçue pour un fonctionnement sur nœud unique, ne fournit pas de clustering de basculement automatique ; la base de données, les flux de travail, les plugins utilisateur et les matériaux de sécurité d'exécution doivent être sauvegardés avant les mises à niveau et la récupération ;
- Les capacités pour ACME, CA externes, API de fournisseurs et réseaux complexes évoluent avec les versions—veuillez vous référer à la documentation utilisateur actuelle, au répertoire de compatibilité des plugins et aux résultats d'environnement réels.

## Documentation officielle

Pour les manuels utilisateur complets, la documentation de développement, les matériaux produit et les spécifications techniques, veuillez visiter :

**https://docs.tlsflow.com**

## Licence

Ce projet est un projet à licence combinée. Veuillez d'abord lire la racine [LICENSE](../../LICENSE) :

- Le code source principal et l'implémentation officielle adoptent par défaut **PolyForm Noncommercial 1.0.0** ; l'utilisation commerciale nécessite une licence commerciale séparée ou un CLUF ;
- SDK de plugin, Manifest, contrats Host API et exemples de schéma/protocole publics adoptent par défaut **Apache-2.0** ;
- La documentation et les exemples adoptent par défaut **CC BY 4.0** ;
- Les plugins tiers ou communautaires suivent leurs licences et déclarations accompagnantes.

## Positionnement du projet

TLSFlow ne tente pas de remplacer toutes les CA, contrôleurs Kubernetes ou outils ACME légers. Sa valeur réside dans la transformation des parties les plus facilement incontrôlables "après l'émission de certificat"—relations d'actifs, déploiement de cibles hétérogènes, pré-vérifications, vérification, retour en arrière, approbation, audit et surveillance continue—en un processus d'entreprise unifié, transparent et extensible.

**Utilisez des actifs structurés pour répondre "où sont les certificats", utilisez des plugins et des flux de travail pour répondre "comment déployer", utilisez des pré-vérifications et une vérification pour répondre "le déploiement est-il sûr et efficace", utilisez le retour en arrière et l'audit pour répondre "comment tracer et récupérer en cas de problème".**

# Publier ToutiShop gratuitement sur Cloudflare

Cette version Cloudflare utilise Pages pour les pages du site et Pages Functions pour l’API. Les comptes, commandes, produits, candidatures et paiements manuels sont conservés dans D1. Les paiements clients par carte et les connecteurs fournisseurs restent désactivés. Les 8 articles initiaux sont des exemples.

À la première publication, les inscriptions publiques et les commandes sont fermées par défaut. Les visiteurs peuvent parcourir le catalogue. Cela évite de recueillir des commandes et adresses avant le paiement et les mentions légales. Gardez `ENABLE_ORDERS` fermé tant que Mollie n’est pas intégré et testé. Les créations de comptes peuvent être ouvertes plus tard avec `ENABLE_PUBLIC_ACCOUNTS=1` dans les variables du projet.

## Adresse gratuite

Cloudflare crée une adresse `*.pages.dev`. Choisissez le nom de projet `toutishop` si disponible ; l’adresse sera alors `toutishop.pages.dev`. Si le nom est déjà pris, choisissez un nom proche avant le premier déploiement.

## Mise en place

1. Déposez le contenu de ce dossier dans un dépôt GitHub. Le dépôt peut rester privé.
2. Dans Cloudflare, ouvrez **Workers & Pages → Create application → Pages → Connect to Git** et sélectionnez ce dépôt.
3. Dans les réglages de construction, laissez la commande de build vide et indiquez `public` comme dossier de sortie. Si vous avez placé ce dossier dans un dépôt plus grand, choisissez `cloudflare` comme dossier racine.
4. Créez une base **D1** dans Cloudflare. Dans sa console SQL, exécutez une fois le fichier `schema.sql` de ce dossier. Cela crée la base et les produits d’exemple.
5. Dans les paramètres du projet Pages, ajoutez une liaison D1 avec le nom de variable exact `TOUTISHOP_DB`, puis sélectionnez la base créée. Redéployez le projet.
6. Dans les variables/secrets du projet, ajoutez le secret `ADMIN_BOOTSTRAP_TOKEN` avec une longue valeur aléatoire, uniquement depuis votre compte privé.
7. Ouvrez `https://NOM-DU-PROJET.pages.dev/setup-admin.html`, saisissez ce code, votre adresse e-mail et un mot de passe d’au moins 12 caractères pour créer votre compte administratrice. Supprimez ensuite le secret `ADMIN_BOOTSTRAP_TOKEN` des paramètres Cloudflare.
8. Connectez-vous au site ; l’onglet **Administration** n’apparaît que pour votre compte administratrice.

## Avant d’accepter de vraies commandes

Les commandes de cette version sont enregistrées **sans paiement**. La page le précise aux clients. Ne mettez pas de vrais produits en vente avant d’avoir activé et testé Mollie, ajouté les vrais stocks et accords partenaires, complété les pages légales et la politique de confidentialité, et vérifié le traitement des remboursements et données personnelles.

Cloudflare propose des quotas gratuits pour Pages, Workers et D1, avec des limites quotidiennes. Les requêtes D1 échouent si les limites gratuites sont dépassées. Consultez les [limites Workers](https://developers.cloudflare.com/workers/platform/limits/) et les [tarifs D1](https://developers.cloudflare.com/d1/platform/pricing/) avant l’ouverture.

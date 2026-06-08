#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════
# COBBLEMON UNIVERSE - Build Server - Gyors Start
# ════════════════════════════════════════════════════════════════════════════════

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🎮 COBBLEMON UNIVERSE - Build Server                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 Válassz egy lehetőséget:"
echo ""
echo "  1) Build szerver indítása (PORT 3000)"
echo "  2) Build szerver indítása (egyéni port)"
echo "  3) Kézikönyv megjelenítése"
echo "  4) Kilépés"
echo ""

read -p "Választás (1-4): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Build szerver indítása port 3000-en..."
        echo ""
        npm run build-server
        ;;
    2)
        echo ""
        read -p "Adj meg egy portszámot (pl. 8080): " port
        if ! [[ "$port" =~ ^[0-9]+$ ]]; then
            echo "❌ Hiba: Érvénytelen port szám"
            exit 1
        fi
        echo ""
        echo "🚀 Build szerver indítása port $port-en..."
        echo ""
        PORT=$port npm run build-server
        ;;
    3)
        echo ""
        cat build-tools/docs/BUILD_SERVER.md
        echo ""
        ;;
    4)
        echo "Kilépés"
        exit 0
        ;;
    *)
        echo "❌ Érvénytelen választás"
        exit 1
        ;;
esac

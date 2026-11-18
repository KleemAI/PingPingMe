# Postman — Business Messaging API

1. Start the backend (`backend\start-backend.bat`) — wait for `API ready`.
2. Postman → **Import** → select both files in this folder.
3. Top-right environment selector → **Business Messaging – Local**.
4. Open folder **0. Health & Auth** → **Run** (or send each request). This signs in admin, agent and reseller and saves their tokens.
5. Run any other folder. **2. Full workflow** goes enquiry → reseller → quote → approval → order → delivery in order.

Tips
- Every request has tests (see the *Test Results* tab).
- **12. Files → Upload file**: pick a file in the *Body* tab first.
- **15. Customers**: sign-up with a fresh email each run, customer access limits, and manual verification by the team. Run it in order after folder 0.
- **16. P2P market**: a full trade between the reseller and the customer from folder 15 — run it after folder 15.
- **17. Catalog, customer chat & ask for price**: run after folder 15.
- **14. Dev → Reset demo data** wipes the database back to the demo data; run folder 0 again afterwards.
- Testing from another PC/phone: change `baseUrl` in the environment to `http://<your-PC-IP>:4000/api/v1`.

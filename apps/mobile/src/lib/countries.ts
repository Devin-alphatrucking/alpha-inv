/** The countries a company can start in, with an example mobile number written the way people there write it (same list as the website's sign-up). */
export const COUNTRIES: { code: string; label: string; example: string; hint: string }[] = [
  { code: "IN", label: "India", example: "98765 43210", hint: "10-digit Indian mobile number. No +91 needed." },
  { code: "AU", label: "Australia", example: "0412 345 678", hint: "An Australian number, or with its country code (+61)." },
  { code: "NZ", label: "New Zealand", example: "021 123 4567", hint: "A New Zealand number, or with its country code (+64)." },
  { code: "GB", label: "United Kingdom", example: "07400 123456", hint: "A UK number, or with its country code (+44)." },
  { code: "US", label: "United States", example: "(201) 555-0123", hint: "A US number, or with its country code (+1)." },
  { code: "CA", label: "Canada", example: "(204) 555-0123", hint: "A Canadian number, or with its country code (+1)." },
  { code: "SG", label: "Singapore", example: "8123 4567", hint: "A Singapore number, or with its country code (+65)." },
  { code: "AE", label: "United Arab Emirates", example: "050 123 4567", hint: "A UAE number, or with its country code (+971)." },
  { code: "ZA", label: "South Africa", example: "082 123 4567", hint: "A South African number, or with its country code (+27)." },
];

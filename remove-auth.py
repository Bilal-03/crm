import re

with open('crm-system.jsx', 'r') as f:
    content = f.read()

# Replace <AuthPage /> call with Clerk's SignIn
content = re.sub(
    r"if \(\!user\) \{\n    return <AuthPage />;\n  \}",
    r"""if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 via-white to-gray-100">
        <SignIn />
      </div>
    );
  }""",
    content
)

# Remove the AuthPage component entirely
content = re.sub(
    r"// Auth Page Component\nfunction AuthPage\(\) \{[\s\S]*?(?=// Auth Page Component ends here|// Dashboard Page Component|// Or just the end of the file|export default function CRMApp|export \{)",
    # Wait, the best way to remove AuthPage is to use a slightly safer regex or find its end. 
    # But since it's at the end or before another component, let's see what's after AuthPage.
    "",
    content
)

with open('crm-system.jsx', 'w') as f:
    f.write(content)
